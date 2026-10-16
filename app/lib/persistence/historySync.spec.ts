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

vi.mock('./db', () => ({
  setMessages: vi.fn(async (_db: unknown, id: string, messages: unknown[], urlId?: string, description?: string) => {
    store.set(id, { id, messages, urlId, description });
  }),
}));

vi.mock('./chatCache', () => ({
  getCachedMessages: vi.fn(async (_db: unknown, id: string) => {
    const found = store.get(id);

    if (!found) {
      throw new Error('not found');
    }

    return found;
  }),
}));

import { migrateLocalHistoryToServer, markDeleted, clearDeletedIds, pushChat } from './historySync';
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
