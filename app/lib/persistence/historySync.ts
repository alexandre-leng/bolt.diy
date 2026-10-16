import { getCachedMessages } from './chatCache';
import { setMessages } from './db';
import { getHistory, listHistory, pickNewest, putHistory, type ChatSummary } from './syncClient';
import type { ChatHistoryItem } from './useChatHistory';
import { createScopedLogger } from '~/utils/logger';

/*
 * Reconciles the local IndexedDB cache with bolt-history, the server-side store.
 *
 * Why this exists: history lives in the browser, so a conversation opened on the desktop
 * does not exist on the phone. The server becomes the source of truth and the local cache
 * is what makes the app feel instant. Every function here fails soft — a sync problem must
 * never stop the user from reading the history they already have locally.
 */
const logger = createScopedLogger('HistorySync');

/**
 * True when the server could not be reached; the local cache was used as-is.
 */
export interface Reconciliation {
  /* Pulled from the server because the local copy was missing or older. */
  pulled: number;

  /* Pushed to the server because the local copy was newer. */
  pushed: number;

  /** True when the server could not be reached; the local cache was used as-is. */
  offline: boolean;
}

/*
 * Ids deleted during this page's lifetime.
 *
 * Deletion is a local write and a server write that cannot be made atomic, and the sync
 * runs on the history list load — the same moment the delete triggers a refresh. Without
 * this registry the migration could re-push the chat from a cache read taken just before
 * the delete, or pull it back from a server response that raced the DELETE, and the
 * conversation the user just removed would reappear.
 *
 * Entries are kept for the session: a deleted id must never be resurrected by a later
 * sync, and the set is tiny.
 */
const deletedIds = new Set<string>();

/** Remember that a chat was deleted so no later sync can bring it back. */
export function markDeleted(id: string, urlId?: string): void {
  deletedIds.add(id);

  if (urlId) {
    deletedIds.add(urlId);
  }
}

/** Test seam: forget every recorded deletion. */
export function clearDeletedIds(): void {
  deletedIds.clear();
}

/** Whether this id (or its server counterpart) has been deleted in this session. */
export function isDeleted(id: string, urlId?: string): boolean {
  return deletedIds.has(id) || (urlId ? deletedIds.has(urlId) : false);
}

/**
 * Bring one chat in line with the server.
 *
 * Returns the chat to display. If the server has a newer copy it is written into the local
 * cache first, so a reload without the server still shows it.
 */
export async function reconcileChat(database: IDBDatabase, id: string): Promise<ChatHistoryItem | undefined> {
  const local = await getCachedMessages(database, id).catch(() => undefined);
  const remoteResult = await getHistory(id);

  if (!remoteResult.ok || !remoteResult.data) {
    return local;
  }

  /*
   * A brand-new id with an empty server record would otherwise seed the cache with a
   * blank conversation and start the push-pull loop that spreads it.
   */
  if (remoteResult.data.messages.length === 0 && !local) {
    return undefined;
  }

  const winner = pickNewest(local, remoteResult.data);

  if (winner === 'remote') {
    const remote = remoteResult.data;

    await setMessages(
      database,
      remote.id,
      remote.messages,
      remote.urlId ?? id,
      remote.description,
      undefined,
      remote.metadata,
    ).catch((error) => logger.debug('could not cache the server copy', error));

    return remote;
  }

  // Local is newer (or the timestamps tie): the server is the one that is behind.
  if (local) {
    void putHistory(local);
  }

  return local;
}

/**
 * Push every locally stored conversation the server does not have yet, and pull back the
 * ones it has that this device never saw. This is the "open it on my phone" path.
 */
export async function migrateLocalHistoryToServer(database: IDBDatabase, localIds: string[]): Promise<Reconciliation> {
  const result: Reconciliation = { pulled: 0, pushed: 0, offline: false };

  const remoteResult = await listHistory();

  if (!remoteResult.ok || !remoteResult.data) {
    result.offline = true;

    return result;
  }

  const remoteById = new Map<string, ChatSummary>(remoteResult.data.map((chat) => [chat.id, chat]));

  for (const id of localIds) {
    if (isDeleted(id)) {
      continue;
    }

    const local = await getCachedMessages(database, id).catch(() => undefined);

    if (!local) {
      continue;
    }

    if (isDeleted(local.id, local.urlId)) {
      continue;
    }

    const remote = remoteById.get(id);

    /*
     * Never push an empty conversation. A cached record with no messages is a stub —
     * an interrupted creation, a deleted project, a test fixture — and pushing it gives
     * the server a blank copy that then spreads to every other device (see pickNewest).
     */
    if (local.messages.length === 0) {
      continue;
    }

    const newest = pickNewest(local, remote);

    if (newest === 'local') {
      if (await pushChat(local)) {
        result.pushed += 1;
      }
    } else if (newest === 'remote' && (await pullNewerCopy(database, id, local))) {
      /*
       * The summary says the server copy is newer — the conversation went on from another
       * device. This branch did not exist: a chat already cached here was only ever
       * pushed, never pulled, and nothing else calls reconcileChat, so the desktop kept
       * showing the conversation as it was before the phone continued it.
       */
      result.pulled += 1;
    }
  }

  for (const summary of remoteResult.data) {
    if (localIds.includes(summary.id)) {
      continue;
    }

    const remote = await getHistory(summary.id);

    if (!remote.ok || !remote.data) {
      continue;
    }

    /*
     * A chat deleted in this session must never be pulled back, even if the server
     * response raced the DELETE and still lists it.
     */
    if (isDeleted(summary.id, remote.data.urlId ?? summary.urlId ?? undefined)) {
      continue;
    }

    /*
     * Skip empty server records instead of caching them: caching one makes it look local,
     * so the next pass pushes it back and the blank copy never disappears.
     */
    if (remote.data.messages.length === 0) {
      continue;
    }

    await setMessages(
      database,
      remote.data.id,
      remote.data.messages,
      remote.data.urlId ?? summary.urlId ?? summary.id,
      remote.data.description,
      undefined,
      remote.data.metadata,
    ).catch((error) => logger.debug('could not cache a server chat', error));

    result.pulled += 1;
  }

  return result;
}

/** Fetch the full server copy and cache it when it really is the newer one. */
async function pullNewerCopy(database: IDBDatabase, id: string, local: ChatHistoryItem): Promise<boolean> {
  const remote = await getHistory(id);

  // The summary carries no messages: decide again on the full copy (an empty one never wins).
  if (!remote.ok || !remote.data || pickNewest(local, remote.data) !== 'remote') {
    return false;
  }

  if (isDeleted(remote.data.id, remote.data.urlId ?? undefined)) {
    return false;
  }

  try {
    await setMessages(
      database,
      remote.data.id,
      remote.data.messages,
      remote.data.urlId ?? local.urlId ?? id,
      remote.data.description,
      remote.data.timestamp,
      remote.data.metadata,
    );
  } catch (error) {
    logger.debug('could not cache the newer server copy', error);

    return false;
  }

  return true;
}

/*
 * One push at a time per chat, and only the latest state.
 *
 * Every save fired its own PUT. Two saves close together raced on the network, and when the
 * older one landed last the server kept the older conversation — the next device to open it
 * lost the last turn. Pushes for a chat now run in order, and a save that arrives while one
 * is in flight replaces any not-yet-sent state instead of queuing behind it.
 */
const pushChains = new Map<string, Promise<boolean>>();
const pendingPush = new Map<string, ChatHistoryItem>();

/** Push one conversation to the server after it changed locally. */
export function pushChat(chat: ChatHistoryItem): Promise<boolean> {
  const key = chat.id;
  pendingPush.set(key, chat);

  const previous = pushChains.get(key) ?? Promise.resolve(true);

  const run: Promise<boolean> = previous.then(async (previousResult) => {
    const latest = pendingPush.get(key);

    if (!latest) {
      // A newer call already sent this state (or a newer one); report how that went.
      return previousResult;
    }

    pendingPush.delete(key);

    try {
      return (await putHistory(latest)).ok;
    } catch (error) {
      logger.debug('push failed', error);

      return false;
    }
  });

  pushChains.set(key, run);
  void run.finally(() => {
    if (pushChains.get(key) === run) {
      pushChains.delete(key);
    }
  });

  return run;
}
