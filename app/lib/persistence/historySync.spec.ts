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

import { migrateLocalHistoryToServer, markDeleted, clearDeletedIds } from './historySync';
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
