import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportExportService } from './importExportService';

/**
 * Minimal IDBDatabase stub. getAllChats only touches db.name, db.version,
 * db.transaction(['chats'], 'readonly') -> objectStore('chats').getAll().
 */
function stubDb(rows: unknown[]): IDBDatabase {
  const request: Record<string, unknown> = {};

  const store = {
    getAll: () => {
      queueMicrotask(() => {
        request.result = rows;
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },

    // deleteAllChats clears the local copy through deleteChat -> store.delete(id).
    delete: (_id: string) => {
      const deleteRequest: Record<string, unknown> = {};

      queueMicrotask(() => {
        (deleteRequest.onsuccess as (() => void) | undefined)?.();
      });

      return deleteRequest;
    },
  };

  const transaction = { objectStore: () => store };

  return {
    name: 'stub',
    version: 2,
    transaction: () => transaction,
  } as unknown as IDBDatabase;
}

describe('ImportExportService.exportAllChats', () => {
  it('preserves parts, annotations and attachments on every message', async () => {
    const messages = [
      {
        id: 'm1',
        role: 'user',
        content: 'hello',
        annotations: [{ type: 'chatSummary', summary: 's' }],
        experimental_attachments: [{ name: 'a.png', contentType: 'image/png', url: 'data:image/png;base64,AAA' }],
      },
      {
        id: 'm2',
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', text: 'hi' },
          {
            type: 'tool-invocation',
            toolInvocation: { toolCallId: 'tc1', toolName: 'bash', args: { cmd: 'ls' }, state: 'result', result: 'ok' },
          },
        ],
        reasoning: 'thought',
      },
    ];

    const exported = await ImportExportService.exportAllChats(stubDb([{ id: 'c1', messages }]));

    expect(exported.chats).toHaveLength(1);
    expect(exported.chats[0].messages).toEqual(messages);
  });

  it('keeps unknown/future message fields instead of dropping them', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'x', someFutureField: { keep: true } }];

    const exported = await ImportExportService.exportAllChats(stubDb([{ id: 'c1', messages }]));

    expect(exported.chats[0].messages[0]).toHaveProperty('someFutureField', { keep: true });
  });

  it('does not alias the stored message objects', async () => {
    const messages = [{ id: 'm1', role: 'user', content: 'x' }];

    const exported = await ImportExportService.exportAllChats(stubDb([{ id: 'c1', messages }]));

    expect(exported.chats[0].messages[0]).not.toBe(messages[0]);
  });

  it('still fills in chat-level defaults', async () => {
    const exported = await ImportExportService.exportAllChats(
      stubDb([{ id: 'c1', messages: [{ id: 'm1', role: 'user', content: 'x' }] }]),
    );

    expect(exported.chats[0].description).toBe('');
    expect(exported.chats[0].urlId).toBeNull();
    expect(exported.chats[0].metadata).toBeNull();
    expect(exported.exportDate).toBeTruthy();
  });

  it('rejects when the database is missing', async () => {
    await expect(ImportExportService.exportAllChats(undefined as unknown as IDBDatabase)).rejects.toThrow(
      'Database not initialized',
    );
  });
});

/*
 * "Deleting a conversation doesn't work" was really "the conversation comes back a
 * second later". The local store is only a cache and bolt-history is the source of
 * truth, so wiping IndexedDB alone left the server row intact; the next sync saw an
 * unknown chat and pulled it straight back in. These tests pin the server purge.
 */
describe('ImportExportService.deleteAllChats', () => {
  const calls: Array<{ url: string; method?: string }> = [];

  function mockFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }),
    );
  }

  beforeEach(() => {
    calls.length = 0;
    vi.unstubAllGlobals();
    mockFetch();
  });

  it('deletes each chat on the server before clearing the local cache', async () => {
    const db = stubDb([
      { id: 'chat-1', urlId: '2-aaa-0', messages: [] },
      { id: 'chat-2', urlId: '2-bbb-0', messages: [] },
    ]);

    await ImportExportService.deleteAllChats(db);

    const deleted = calls.filter((call) => call.method === 'DELETE').map((call) => call.url);

    expect(deleted).toContain('/api/history/chat-1');
    expect(deleted).toContain('/api/history/chat-2');
  });

  it('does not throw when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    await expect(ImportExportService.deleteAllChats(stubDb([{ id: 'chat-1', messages: [] }]))).resolves.toBeUndefined();
  });

  it('purges the server even for a chat with no urlId', async () => {
    await ImportExportService.deleteAllChats(stubDb([{ id: 'chat-1', messages: [] }]));

    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toContain('/api/history/chat-1');
  });
});
