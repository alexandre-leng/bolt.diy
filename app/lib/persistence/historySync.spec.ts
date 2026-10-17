import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Regression tests for "the deleted conversation comes back".
 *
 * The sidebar deleted a chat from IndexedDB only. The next `loadEntries()` called
 * `migrateLocalHistoryToServer`, which still found the chat on bolt-history, treated it
 * as a chat this device had never seen and pulled it back into the cache — so the
 * conversation reappeared a second after being deleted, and stayed gone only until the
 * next sync.
 *
 * These tests drive the real sync functions against a stubbed fetch and a stubbed local
 * store, so they fail if the purge and the migration are ever decoupled again.
 */
const store = new Map<string, Record<string, unknown>>();

/*
 * Behaves like the real store on the points under test: `urlId` is a unique index (a
 * duplicate rejects with a ConstraintError, as IndexedDB does) and deleteById drops the record.
 */
const byUrlId = (urlId: string) => [...store.values()].find((chat) => chat.urlId === urlId);

vi.mock('./db', () => ({
  setMessages: vi.fn(
    async (_db: unknown, id: string, messages: unknown[], urlId?: string, description?: string, timestamp?: string) => {
      const holder = urlId ? byUrlId(urlId) : undefined;

      if (holder && holder.id !== id) {
        throw Object.assign(new Error('Unable to add key to index urlId'), { name: 'ConstraintError' });
      }

      store.set(id, { id, messages, urlId, description, timestamp: timestamp ?? new Date().toISOString() });
    },
  ),
  getMessagesByIdRaw: vi.fn(async (_db: unknown, id: string) => store.get(id)),
  getMessagesByUrlIdRaw: vi.fn(async (_db: unknown, urlId: string) => byUrlId(urlId)),
  getUrlId: vi.fn(async (_db: unknown, wanted: string) => {
    let candidate = wanted;
    let suffix = 2;

    while (byUrlId(candidate)) {
      candidate = `${wanted}-${suffix++}`;
    }

    return candidate;
  }),
  deleteById: vi.fn(async (_db: unknown, id: string) => {
    store.delete(id);
  }),
}));

vi.mock('./chatCache', () => ({
  getCachedMessages: vi.fn(async (_db: unknown, id: string) => {
    const found = store.get(id) ?? byUrlId(id);

    if (!found) {
      throw new Error('not found');
    }

    return found;
  }),
  invalidateChatCache: vi.fn(),
}));

import { invalidateChatCache } from './chatCache';
import {
  chatFingerprint,
  migrateLocalHistoryToServer,
  markDeleted,
  resetPushFingerprints,
  clearDeletedIds,
  pushChat,
  reconcileChat,
  renameChat,
} from './historySync';
import { deleteHistory } from './syncClient';

type FetchArgs = [url: string, init?: RequestInit];

/** A server holding one chat, that honours DELETE. */
function stubServerWithDelete(): { deleted: string[] } {
  const deleted: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (...args: FetchArgs) => {
      const [url, init] = args;
      const path = String(url).replace('/api/history', '');

      if (init?.method === 'DELETE') {
        deleted.push(path.replace(/^\//, ''));
        return { ok: true, status: 200, json: async () => ({ ok: true, removed: 1 }) };
      }

      if (path === '' || path === '/') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            chats: [{ id: 'chat-1', urlId: '2-aaa-0', timestamp: '2026-01-01T00:00:00Z' }],
          }),
        };
      }

      // GET /chat-1 after it was deleted answers 404, like the real service.
      if (deleted.includes('chat-1')) {
        return { ok: false, status: 404, json: async () => ({ ok: false }) };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          chat: { id: 'chat-1', urlId: '2-aaa-0', timestamp: '2026-01-01T00:00:00Z', messages: [{ role: 'user' }] },
        }),
      };
    }),
  );

  return { deleted };
}

describe('history sync and deletion', () => {
  beforeEach(() => {
    store.clear();
    clearDeletedIds();
    vi.unstubAllGlobals();
  });

  it('pulls a chat from the server when the device has never seen it', async () => {
    stubServerWithDelete();

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, []);

    expect(result.pulled).toBe(1);
    expect(store.has('chat-1')).toBe(true);
  });

  /*
   * THE regression. Delete on the server, then sync: the chat must NOT come back.
   * Before the fix the delete only touched IndexedDB and this migration restored it.
   */
  it('does not restore a chat that was deleted on the server', async () => {
    const { deleted } = stubServerWithDelete();

    await deleteHistory('chat-1');
    expect(deleted).toContain('chat-1');

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, []);

    expect(result.pulled).toBe(0);
    expect(store.has('chat-1')).toBe(false);
  });

  it('keeps a locally present chat and does not duplicate it', async () => {
    stubServerWithDelete();
    store.set('chat-1', {
      id: 'chat-1',
      urlId: '2-aaa-0',
      timestamp: '2026-01-01T00:00:00Z',
      messages: [{ role: 'user' }],
    });

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, ['chat-1']);

    expect(result.pulled).toBe(0);
    expect(store.size).toBe(1);
  });

  /*
   * The other half of the bug: a sync that runs while the DELETE is still in flight saw
   * the chat in its own list response and pulled it back. `markDeleted` closes that race,
   * so the migration must refuse it even though the server still advertises it.
   */
  it('never pulls a chat marked as deleted, even if the server still lists it', async () => {
    stubServerWithDelete();

    markDeleted('chat-1', '2-aaa-0');

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, []);

    expect(result.pulled).toBe(0);
    expect(store.has('chat-1')).toBe(false);
  });

  it('recognises a deleted chat by its urlId as well as its id', async () => {
    stubServerWithDelete();

    // The sidebar deletes by local id; the server list is keyed differently.
    markDeleted('2-aaa-0');

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, []);

    expect(result.pulled).toBe(0);
    expect(store.has('chat-1')).toBe(false);
  });

  it('never re-pushes a locally cached chat that was deleted', async () => {
    stubServerWithDelete();
    store.set('chat-1', {
      id: 'chat-1',
      urlId: '2-aaa-0',
      timestamp: '2026-06-01T00:00:00Z',
      messages: [{ role: 'user' }],
    });

    markDeleted('chat-1', '2-aaa-0');

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, ['chat-1']);

    expect(result.pushed).toBe(0);
  });
});

/*
 * Regression for "my conversation never reaches the server".
 *
 * The sidebar listed only chats carrying a `urlId` AND a `description`, and handed that
 * same filtered list to `migrateLocalHistoryToServer`. A chat with no `urlId` is exactly
 * the one that exists only in this browser — the one the server needs — so filtering
 * before migrating dropped precisely the records migration exists to save, and an empty
 * server stayed empty however often the list refreshed.
 *
 * The fix keeps the display filter (a presentable list) while passing every cached id to
 * the migration. This test pins the migration's own contract: given a local-only id, it
 * uploads.
 */
describe('migration uploads a local-only chat', () => {
  beforeEach(() => {
    store.clear();
    clearDeletedIds();
    vi.unstubAllGlobals();
  });

  function stubEmptyServer(): { pushed: string[] } {
    const pushed: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: FetchArgs) => {
        const [url, init] = args;
        const path = String(url).replace('/api/history', '');

        if (init?.method === 'PUT' || init?.method === 'POST') {
          pushed.push(String(url));
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }

        if (path === '' || path === '/') {
          return { ok: true, status: 200, json: async () => ({ ok: true, chats: [] }) };
        }

        return { ok: false, status: 404, json: async () => ({ ok: false }) };
      }),
    );

    return { pushed };
  }

  it('uploads a chat that has no urlId yet', async () => {
    const { pushed } = stubEmptyServer();

    // No urlId and no description: this is what a browser-only chat looks like.
    store.set('local-only', {
      id: 'local-only',
      timestamp: '2026-07-01T00:00:00Z',
      messages: [{ role: 'user' }],
    });

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, ['local-only']);

    expect(result.pushed).toBe(1);
    expect(pushed.length).toBe(1);
  });

  it('still refuses to upload a stub with no messages', async () => {
    stubEmptyServer();
    store.set('empty-stub', {
      id: 'empty-stub',
      timestamp: '2026-07-01T00:00:00Z',
      messages: [],
    });

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, ['empty-stub']);

    expect(result.pushed).toBe(0);
  });
});

/*
 * C2 — a chat continued on another device. The server copy is newer, the local one is
 * cached: the migration only ever pushed, so this device kept the old conversation.
 */
describe('a chat continued on another device', () => {
  beforeEach(() => {
    store.clear();
    clearDeletedIds();
    vi.unstubAllGlobals();
  });

  function stubServer(remote: { timestamp: string; messages: unknown[] }) {
    const puts: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: FetchArgs) => {
        const [url, init] = args;
        const path = String(url).replace('/api/history', '');

        if (init?.method === 'PUT') {
          puts.push(path);
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }

        if (path === '' || path === '/') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, chats: [{ id: 'chat-1', urlId: '2-aaa-0', timestamp: remote.timestamp }] }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, chat: { id: 'chat-1', urlId: '2-aaa-0', ...remote } }),
        };
      }),
    );

    return { puts };
  }

  it('pulls the newer server copy over the cached one', async () => {
    store.set('chat-1', {
      id: 'chat-1',
      urlId: '2-aaa-0',
      timestamp: '2026-01-01T00:00:00Z',
      messages: [{ role: 'user' }],
    });

    const { puts } = stubServer({
      timestamp: '2026-02-01T00:00:00Z',
      messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }],
    });

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, ['chat-1']);

    expect(result.pulled).toBe(1);
    expect((store.get('chat-1')?.messages as unknown[]).length).toBe(3);
    expect(puts).toEqual([]);
  });

  it('never replaces a populated local chat with an empty newer copy', async () => {
    store.set('chat-1', {
      id: 'chat-1',
      urlId: '2-aaa-0',
      timestamp: '2026-01-01T00:00:00Z',
      messages: [{ role: 'user' }],
    });
    stubServer({ timestamp: '2026-02-01T00:00:00Z', messages: [] });

    const result = await migrateLocalHistoryToServer({} as IDBDatabase, ['chat-1']);

    expect(result.pulled).toBe(0);
    expect((store.get('chat-1')?.messages as unknown[]).length).toBe(1);
  });
});

/*
 * C3 — two saves close together. Each fired its own PUT; when the older one landed last the
 * server kept the older conversation.
 */
describe('pushChat ordering', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('lands the latest state last, even when the earlier request is slower', async () => {
    let serverCopy = '';
    let calls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const delay = calls++ === 0 ? 40 : 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
        serverCopy = body.description;

        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }),
    );

    const chat = { id: 'race-1', urlId: 'r', timestamp: '2026-01-01T00:00:00Z', messages: [{ role: 'user' }] };
    const first = pushChat({ ...chat, description: 'v1' } as never);
    const second = pushChat({ ...chat, description: 'v2' } as never);

    await Promise.all([first, second]);

    expect(serverCopy).toBe('v2');
  });

  it('sends only the newest of several queued saves', async () => {
    const sent: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)).description);
        await new Promise((resolve) => setTimeout(resolve, 10));

        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }),
    );

    const chat = { id: 'race-2', urlId: 'r2', timestamp: '2026-01-01T00:00:00Z', messages: [{ role: 'user' }] };
    const results = await Promise.all(['a', 'b', 'c', 'd'].map((d) => pushChat({ ...chat, description: d } as never)));

    expect(sent[sent.length - 1]).toBe('d');
    expect(sent.length).toBeLessThan(4);
    expect(results).toEqual([true, true, true, true]);
  });
});

/*
 * Lot 3 — sync defects found by the persistence audit (plan items P4, P6, P7, P8, P9).
 * A tiny in-memory server: list, get, put (410 for a deleted id), with every call recorded.
 */
describe('lot 3 sync regressions', () => {
  const db = {} as IDBDatabase;

  interface ServerChat {
    id: string;
    urlId?: string;
    description?: string;
    timestamp: string;
    messages: unknown[];
  }

  function stubServer(chats: ServerChat[], deleted?: { id: string; urlId?: string; deletedAt?: string }[]) {
    const calls: { method: string; path: string; body?: any }[] = [];
    const gone = new Set((deleted ?? []).map((tombstone) => tombstone.id));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: FetchArgs) => {
        const [url, init] = args;
        const path = String(url).replace('/api/history', '');
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body });

        if (method === 'PUT') {
          if (gone.has(decodeURIComponent(path.replace(/^\//, '')))) {
            return { ok: false, status: 410, json: async () => ({ ok: false, error: 'deleted' }) };
          }

          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }

        if (path === '' || path === '/') {
          const summaries = chats.map(({ messages: _messages, ...summary }) => summary);
          const payload = deleted ? { ok: true, chats: summaries, deleted } : { ok: true, chats: summaries };

          return { ok: true, status: 200, json: async () => payload };
        }

        const key = decodeURIComponent(path.replace(/^\//, ''));
        const chat = chats.find((candidate) => candidate.id === key || candidate.urlId === key);

        return chat
          ? { ok: true, status: 200, json: async () => ({ ok: true, chat }) }
          : { ok: false, status: 404, json: async () => ({ ok: false }) };
      }),
    );

    return calls;
  }

  beforeEach(() => {
    store.clear();
    clearDeletedIds();
    vi.unstubAllGlobals();
    vi.mocked(invalidateChatCache).mockClear();
  });

  /*
   * P4. Every device names its first template chat `imported-files`. Pulling the other
   * device's one hit the unique urlId index: ConstraintError swallowed, chat never shown,
   * `pulled` still counted, and the whole chat downloaded again on every sync.
   */
  it('P4: stores a pulled chat whose urlId is already taken locally under a free urlId', async () => {
    store.set('1', { id: '1', urlId: 'imported-files', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'a' }] });

    const calls = stubServer([
      { id: '1', urlId: 'imported-files', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'a' }] },
      { id: '2', urlId: 'imported-files', timestamp: '2026-02-01T00:00:00Z', messages: [{ id: 'b' }] },
    ]);

    const first = await migrateLocalHistoryToServer(db, ['1']);

    expect(first.pulled).toBe(1);
    expect(store.get('2')?.urlId).toBe('imported-files-2');
    expect(store.get('1')?.urlId).toBe('imported-files');

    calls.length = 0;

    const second = await migrateLocalHistoryToServer(db, ['1', '2']);

    expect(second).toEqual({ pulled: 0, pushed: 0, offline: false });
    expect(calls.filter((call) => call.path !== '' && call.path !== '/')).toEqual([]);
  });

  it('P4: does not count a pull that could not be stored', async () => {
    store.set('1', { id: '1', urlId: 'taken', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'a' }] });
    stubServer([{ id: '2', urlId: 'taken', timestamp: '2026-02-01T00:00:00Z', messages: [{ id: 'b' }] }]);

    const { setMessages } = await import('./db');
    vi.mocked(setMessages).mockRejectedValueOnce(new Error('QuotaExceededError'));

    const result = await migrateLocalHistoryToServer(db, ['1']);

    expect(result.pulled).toBe(0);
  });

  /*
   * P6. A chat deleted on another device is listed as a tombstone: the local copy must go
   * (snapshot included, through deleteById) instead of being pushed back to life.
   */
  it('P6: deletes the local copy of a chat the server lists as deleted, without pushing it', async () => {
    store.set('X', { id: 'X', urlId: 'x', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'm' }] });

    const calls = stubServer([], [{ id: 'X', urlId: 'x', deletedAt: '2026-03-01T00:00:00Z' }]);

    const result = await migrateLocalHistoryToServer(db, ['X']);

    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
    expect(result.pushed).toBe(0);
    expect(store.has('X')).toBe(false);

    const { deleteById } = await import('./db');
    expect(deleteById).toHaveBeenCalledWith(db, 'X');
  });

  it('P6: a 410 on push deletes the local copy and stops pushing it', async () => {
    const chat = { id: 'X', urlId: 'x', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'm' }] };
    store.set('X', { ...chat });

    const calls = stubServer([], [{ id: 'X', urlId: 'x' }]);

    expect(await pushChat(chat as never, db)).toBe(false);
    expect(store.has('X')).toBe(false);

    calls.length = 0;
    await pushChat(chat as never, db);
    expect(calls).toEqual([]);
  });

  it('P6: tolerates a server that sends no tombstones', async () => {
    store.set('X', { id: 'X', urlId: 'x', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'm' }] });
    stubServer([]);

    const result = await migrateLocalHistoryToServer(db, ['X']);

    expect(result.pushed).toBe(1);
    expect(store.has('X')).toBe(true);
  });

  /*
   * P7. A pull rewrote IndexedDB but the in-memory cache (prefetched on hover) kept the old
   * promise: the chat opened stale and its next save re-uploaded the old turns.
   */
  it('P7: invalidates the cached chat after pulling a newer server copy', async () => {
    store.set('1', { id: '1', urlId: 'one', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'a' }] });
    stubServer([
      { id: '1', urlId: 'one', timestamp: '2026-02-01T00:00:00Z', messages: [{ id: 'a' }, { id: 'b' }] },
      { id: '9', urlId: 'nine', timestamp: '2026-02-01T00:00:00Z', messages: [{ id: 'c' }] },
    ]);

    await migrateLocalHistoryToServer(db, ['1']);

    expect(invalidateChatCache).toHaveBeenCalledWith('1');
    expect(invalidateChatCache).toHaveBeenCalledWith('one');
    expect(invalidateChatCache).toHaveBeenCalledWith('9');
  });

  /*
   * P9. After a pull both copies carry the same timestamp; pickNewest keeps 'local' on a
   * tie, so every sidebar opening re-uploaded every synchronised chat in full.
   */
  it('P9: does not re-upload a chat whose server copy has the same timestamp', async () => {
    store.set('1', { id: '1', urlId: 'one', timestamp: '2026-01-01T00:00:00.000Z', messages: [{ id: 'a' }] });

    const calls = stubServer([
      { id: '1', urlId: 'one', timestamp: '2026-01-01T00:00:00.000Z', messages: [{ id: 'a' }] },
    ]);

    const result = await migrateLocalHistoryToServer(db, ['1']);

    expect(result.pushed).toBe(0);
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
  });

  it('P9: keeps the server timestamp on a pulled chat, so the next sync is a no-op', async () => {
    const calls = stubServer([
      { id: '5', urlId: 'five', timestamp: '2026-01-01T00:00:00.000Z', messages: [{ id: 'a' }] },
    ]);

    await migrateLocalHistoryToServer(db, []);
    expect(store.get('5')?.timestamp).toBe('2026-01-01T00:00:00.000Z');

    calls.length = 0;
    await migrateLocalHistoryToServer(db, ['5']);
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
  });

  /*
   * P1 (server side of it): a chat absent locally, opened by its urlId, is fetched and cached.
   */
  it('P1: reconcileChat fetches and caches a chat this device never had', async () => {
    stubServer([{ id: '7', urlId: 'shared-link', timestamp: '2026-01-01T00:00:00Z', messages: [{ id: 'a' }] }]);

    const chat = await reconcileChat(db, 'shared-link');

    expect(chat?.id).toBe('7');
    expect(store.get('7')?.urlId).toBe('shared-link');
    expect(invalidateChatCache).toHaveBeenCalledWith('shared-link');
  });

  /*
   * P8. Renaming kept the old timestamp, skipped the cache and never pushed: the old name
   * came back from the cache or from the server, and no other device saw the new one.
   */
  it('P8: renameChat stamps, invalidates and pushes the new description', async () => {
    store.set('1', {
      id: '1',
      urlId: 'one',
      description: 'Old',
      timestamp: '2026-01-01T00:00:00.000Z',
      messages: [{ id: 'a' }],
    });

    const calls = stubServer([
      { id: '1', urlId: 'one', description: 'Old', timestamp: '2026-02-01T00:00:00.000Z', messages: [{ id: 'a' }] },
    ]);

    const updated = await renameChat(db, '1', 'Café de Noël');

    expect(updated.description).toBe('Café de Noël');
    expect(store.get('1')?.description).toBe('Café de Noël');
    expect(Date.parse(store.get('1')?.timestamp as string)).toBeGreaterThan(Date.parse('2026-02-01T00:00:00.000Z'));
    expect(invalidateChatCache).toHaveBeenCalledWith('1');
    expect(invalidateChatCache).toHaveBeenCalledWith('one');

    await vi.waitFor(() => expect(calls.find((call) => call.method === 'PUT')?.body?.description).toBe('Café de Noël'));

    // A later sync against the older server copy keeps the new name.
    await migrateLocalHistoryToServer(db, ['1']);
    expect(store.get('1')?.description).toBe('Café de Noël');
  });
});

/*
 * Storage optimisation: an unchanged conversation is not uploaded again. A long Agent chat
 * (~1 MB) was re-sent whole by every save path even when nothing had changed.
 */
describe('pushChat skips an unchanged conversation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetPushFingerprints();
  });

  it('uploads once, then only when the conversation changes', async () => {
    let puts = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        puts++;

        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }),
    );

    const chat = { id: 'dedupe-1', urlId: 'd1', timestamp: '2026-01-01T00:00:00Z', messages: [{ role: 'user' }] };

    expect(await pushChat(chat as never)).toBe(true);
    expect(await pushChat({ ...chat } as never)).toBe(true);
    expect(puts).toBe(1);

    expect(await pushChat({ ...chat, description: 'renamed' } as never)).toBe(true);
    expect(puts).toBe(2);
  });

  it('retries a save the server did not accept', async () => {
    let puts = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        puts++;

        return puts === 1
          ? { ok: false, status: 503, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ ok: true }) };
      }),
    );

    const chat = { id: 'dedupe-2', urlId: 'd2', timestamp: '2026-01-01T00:00:00Z', messages: [{ role: 'user' }] };

    expect(await pushChat(chat as never)).toBe(false);
    expect(await pushChat(chat as never)).toBe(true);
    expect(puts).toBe(2);
  });

  it('fingerprints differ when any field changes', () => {
    const base = { id: 'x', timestamp: 't', messages: [{ role: 'user', content: 'a' }] } as never;
    const other = { id: 'x', timestamp: 't', messages: [{ role: 'user', content: 'b' }] } as never;

    expect(chatFingerprint(base)).toBe(chatFingerprint({ ...(base as object) } as never));
    expect(chatFingerprint(base)).not.toBe(chatFingerprint(other));
  });
});
