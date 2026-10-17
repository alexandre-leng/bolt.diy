import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMessages, getCachedSnapshot, invalidateChatCache, prefetchChat } from './chatCache';
import * as dbModule from './db';

vi.mock('./db', () => ({
  getMessages: vi.fn(),
  getSnapshot: vi.fn(),
}));

describe('chatCache', () => {
  const fakeDb = {} as IDBDatabase;

  beforeEach(() => {
    invalidateChatCache();
    vi.clearAllMocks();
  });

  it('prefetches messages and snapshot into cache', async () => {
    const fakeChat = { id: 'c1', urlId: 'public-c1', messages: [], timestamp: 'now' } as any;
    const fakeSnapshot = { chatIndex: 'm1', files: {} } as any;

    vi.mocked(dbModule.getMessages).mockResolvedValue(fakeChat);
    vi.mocked(dbModule.getSnapshot).mockResolvedValue(fakeSnapshot);

    prefetchChat(fakeDb, 'public-c1');

    expect(dbModule.getMessages).toHaveBeenCalledTimes(1);

    // Subsequent getCached calls should use the cached promise without extra DB queries
    const messages = await getCachedMessages(fakeDb, 'public-c1');
    const snapshot = await getCachedSnapshot(fakeDb, 'c1');

    expect(messages).toEqual(fakeChat);
    expect(snapshot).toEqual(fakeSnapshot);
    expect(dbModule.getMessages).toHaveBeenCalledTimes(1);
    expect(dbModule.getSnapshot).toHaveBeenCalledTimes(1);
    expect(dbModule.getSnapshot).toHaveBeenCalledWith(fakeDb, 'c1');
  });

  it('invalidates cache by id', async () => {
    const fakeChat1 = { id: 'c1', messages: [], timestamp: 'now' } as any;
    const fakeChat2 = { id: 'c2', messages: [], timestamp: 'now' } as any;

    vi.mocked(dbModule.getMessages).mockResolvedValueOnce(fakeChat1).mockResolvedValueOnce(fakeChat2);

    await getCachedMessages(fakeDb, 'c1');
    expect(dbModule.getMessages).toHaveBeenCalledTimes(1);

    invalidateChatCache('c1');

    await getCachedMessages(fakeDb, 'c1');
    expect(dbModule.getMessages).toHaveBeenCalledTimes(2);
  });

  it('does nothing when prefetching with undefined database or id', () => {
    prefetchChat(undefined, 'c1');
    prefetchChat(fakeDb, '');

    expect(dbModule.getMessages).not.toHaveBeenCalled();
    expect(dbModule.getSnapshot).not.toHaveBeenCalled();
  });

  /*
   * P1. A miss was cached as a resolved `undefined`: once a direct link had bounced to the
   * home page, the chat stayed unreachable at that URL until a full reload, even after the
   * sidebar had pulled it.
   */
  it('does not cache a miss: a chat written later is found on the next read', async () => {
    const pulled = { id: 'x', urlId: 'x', messages: [{ id: 'm' }], timestamp: 'now' } as any;

    vi.mocked(dbModule.getMessages)
      .mockResolvedValueOnce(undefined as any)
      .mockResolvedValueOnce(pulled);

    expect(await getCachedMessages(fakeDb, 'x')).toBeUndefined();
    expect(await getCachedMessages(fakeDb, 'x')).toEqual(pulled);
  });

  it('does not cache a failed read', async () => {
    const chat = { id: 'y', messages: [], timestamp: 'now' } as any;

    vi.mocked(dbModule.getMessages).mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(chat);

    await expect(getCachedMessages(fakeDb, 'y')).rejects.toThrow('blocked');
    expect(await getCachedMessages(fakeDb, 'y')).toEqual(chat);
  });

  it('does not keep a prefetched miss either', async () => {
    const chat = { id: 'z', messages: [{ id: 'm' }], timestamp: 'now' } as any;

    vi.mocked(dbModule.getMessages)
      .mockResolvedValueOnce(undefined as any)
      .mockResolvedValueOnce(chat);
    vi.mocked(dbModule.getSnapshot).mockResolvedValue(undefined);

    prefetchChat(fakeDb, 'z');
    await Promise.resolve();
    await Promise.resolve();

    expect(await getCachedMessages(fakeDb, 'z')).toEqual(chat);
  });
});
