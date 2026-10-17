import { getMessages, getSnapshot } from './db';
import type { Snapshot } from './types';

type ChatHistoryItem = Awaited<ReturnType<typeof getMessages>>;

const messageCache = new Map<string, Promise<ChatHistoryItem>>();
const snapshotCache = new Map<string, Promise<Snapshot | undefined>>();

/**
 * Prefetch chat messages and snapshot from IndexedDB on hover.
 * This primes the in-memory cache before the user clicks to switch chats.
 */
export function prefetchChat(database: IDBDatabase | undefined, id: string) {
  if (!database || !id) {
    return;
  }

  const messages = messageCache.get(id) ?? cacheMessages(database, id);

  void messages
    .then((chat) => {
      if (chat && !snapshotCache.has(chat.id)) {
        snapshotCache.set(chat.id, getSnapshot(database, chat.id));
      }
    })
    .catch(() => undefined);
}

/**
 * Get messages, using the cached promise if available from prefetch.
 */
export async function getCachedMessages(database: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  const cached = messageCache.get(id);

  if (cached) {
    return cached;
  }

  return cacheMessages(database, id);
}

/*
 * A miss (no such chat yet) or a failed read is not cached: the chat may be pulled from the
 * server a moment later, and a cached `undefined` kept sending that route back to the home
 * page until a full reload.
 */
function cacheMessages(database: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  const promise = getMessages(database, id);
  messageCache.set(id, promise);

  const forget = () => {
    if (messageCache.get(id) === promise) {
      messageCache.delete(id);
    }
  };

  promise.then((chat) => {
    if (!chat) {
      forget();
    }
  }, forget);

  return promise;
}

/**
 * Get snapshot, using the cached promise if available from prefetch.
 */
export async function getCachedSnapshot(database: IDBDatabase, id: string): Promise<Snapshot | undefined> {
  const cached = snapshotCache.get(id);

  if (cached) {
    return cached;
  }

  const promise = getSnapshot(database, id);
  snapshotCache.set(id, promise);

  return promise;
}

/**
 * Invalidate cache entry when chat or snapshot is saved/updated.
 */
export function invalidateChatCache(id?: string) {
  if (id) {
    messageCache.delete(id);
    snapshotCache.delete(id);
  } else {
    messageCache.clear();
    snapshotCache.clear();
  }
}
