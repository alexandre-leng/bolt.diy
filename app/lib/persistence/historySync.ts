import { getCachedMessages, invalidateChatCache } from './chatCache';
import { deleteById, getMessagesByIdRaw, getMessagesByUrlIdRaw, getUrlId, setMessages } from './db';
import {
  getHistory,
  listHistory,
  pickNewest,
  putHistory,
  sameVersion,
  type ChatSummary,
  type ChatTombstone,
} from './syncClient';
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
 * Server conversations downloaded per sync pass.
 *
 * Small on purpose: the list is re-read after each pass and the next one runs from the same
 * effect, so rows appear progressively. One pass downloading everything is what turned a large
 * account into an empty list (the first large chat aborted the sync and nothing was kept).
 */
export const PULL_BATCH_SIZE = 6;

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

  /*
   * Chats the server HAS but this device could not download inside the sync window.
   *
   * Measured in production: the server lists 28 conversations for one account, the first sync
   * pulls a handful, then a large one (`/api/history/<id>` answering 1.6 MB) misses the 8 s
   * timeout, the sync aborts and no server chat is ever cached. The list then shows "Aucune
   * conversation" while every conversation is intact on the server.
   */
  failed: number;

  /** Ids still missing locally, oldest first, for the next pass to resume from. */
  pending: string[];
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

export function clearDeleted(id: string, urlId?: string): void {
  deletedIds.delete(id);

  if (urlId) {
    deletedIds.delete(urlId);
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

/** Drop every cached read of a chat after its record changed under the cache. */
function invalidate(...ids: (string | null | undefined)[]): void {
  for (const id of ids) {
    if (id) {
      invalidateChatCache(id);
    }
  }
}

/**
 * The urlId a pulled chat can be stored under on this device.
 *
 * `urlId` is a unique index locally, but every device allocates it on its own: the first
 * template chat is `imported-files` everywhere. Writing a server chat whose urlId another
 * local chat already holds failed with a ConstraintError that was swallowed, so the chat
 * never appeared here and was downloaded again on every sync.
 */
async function storableUrlId(
  database: IDBDatabase,
  id: string,
  wanted: string | null | undefined,
  localUrlId?: string,
): Promise<string> {
  const candidate = wanted || localUrlId || id;
  const holder = await getMessagesByUrlIdRaw(database, candidate).catch(() => undefined);

  if (!holder || holder.id === id) {
    return candidate;
  }

  if (localUrlId && localUrlId !== candidate) {
    return localUrlId;
  }

  return getUrlId(database, candidate);
}

/**
 * Write a server copy into IndexedDB under its own timestamp.
 *
 * The server timestamp is kept so both copies compare equal afterwards: stamping the pull
 * with the local clock made this device look newer and re-upload it on the next sync.
 */
async function cacheServerCopy(
  database: IDBDatabase,
  remote: ChatHistoryItem,
  fallbackUrlId?: string,
  localUrlId?: string,
) {
  const urlId = await storableUrlId(database, remote.id, remote.urlId ?? fallbackUrlId, localUrlId);
  const timestamp = remote.timestamp && !isNaN(Date.parse(remote.timestamp)) ? remote.timestamp : undefined;

  await setMessages(database, remote.id, remote.messages, urlId, remote.description, timestamp, remote.metadata);
  invalidate(remote.id, urlId, remote.urlId, fallbackUrlId, localUrlId);

  return { ...remote, urlId };
}

/**
 * Remove a chat this account deleted elsewhere (server tombstone or a 410 on push).
 * Without it the deleted chat was pushed back from this device and resurrected everywhere.
 */
async function deleteLocalCopy(database: IDBDatabase, id: string, urlId?: string | null): Promise<boolean> {
  markDeleted(id, urlId ?? undefined);

  const local =
    (await getMessagesByIdRaw(database, id).catch(() => undefined)) ||
    (urlId ? await getMessagesByUrlIdRaw(database, urlId).catch(() => undefined) : undefined);

  if (!local) {
    return false;
  }

  markDeleted(local.id, local.urlId);

  try {
    // deleteById removes the snapshot in the same transaction.
    await deleteById(database, local.id);
  } catch (error) {
    logger.debug('could not delete a chat deleted on another device', error);

    return false;
  }

  invalidate(id, urlId, local.id, local.urlId);

  return true;
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

  const remote = remoteResult.data;

  if (isDeleted(remote.id, remote.urlId ?? undefined)) {
    return local;
  }

  if (!local) {
    try {
      return await cacheServerCopy(database, remote, id);
    } catch (error) {
      logger.debug('could not cache the server copy', error);
      return remote;
    }
  }

  // A newer remote version always wins at open. Never issue a PUT from this read path.
  const localTime = Date.parse(local.timestamp);
  const remoteTime = Date.parse(remote.timestamp);
  const localHasContent = Array.isArray(local.messages) && local.messages.length > 0;
  const remoteHasContent = Array.isArray(remote.messages) && remote.messages.length > 0;

  const remoteIsNewer =
    (!localHasContent && remoteHasContent) ||
    (localHasContent === remoteHasContent && !isNaN(remoteTime) && !isNaN(localTime) && remoteTime > localTime);

  if (remoteIsNewer) {
    try {
      return await cacheServerCopy(database, remote, id, local.urlId);
    } catch (error) {
      logger.debug('could not cache the newer server copy', error);
      return remote;
    }
  }

  return local;
}

/**
 * Push every locally stored conversation the server does not have yet, and pull back the
 * ones it has that this device never saw. This is the "open it on my phone" path.
 */
export async function migrateLocalHistoryToServer(
  database: IDBDatabase,
  localIds: string[],
  options: { batchSize?: number } = {},
): Promise<Reconciliation> {
  const result: Reconciliation = { pulled: 0, pushed: 0, offline: false, failed: 0, pending: [] };

  /*
   * A bounded batch, most recent first. Pulling every missing conversation in one pass froze the
   * list on a large account: 28 downloads of up to 2 MB each, on a phone, several of them over
   * the per-request timeout. The caller re-reads the list after each batch, so the user sees rows
   * appearing instead of an empty list and a spinner that gives up.
   */
  const batchSize = options.batchSize ?? PULL_BATCH_SIZE;

  const remoteResult = await listHistory();

  if (!remoteResult.ok || !remoteResult.data) {
    result.offline = true;

    return result;
  }

  const remoteById = new Map<string, ChatSummary>(remoteResult.data.map((chat) => [chat.id, chat]));
  const tombstones: ChatTombstone[] = remoteResult.deleted ?? [];

  /*
   * Deletions made on another device. Before tombstones the server simply stopped listing
   * the chat, this device saw it as "local only" and pushed it back.
   */
  for (const tombstone of tombstones) {
    if (remoteById.has(tombstone.id)) {
      // Deleted and then created again under the same id: the live copy wins.
      continue;
    }

    await deleteLocalCopy(database, tombstone.id, tombstone.urlId);
  }

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
      // Same version on both sides (the usual case after a pull): nothing to upload.
      if (sameVersion(local, remote)) {
        continue;
      }

      if (await pushChat(local, database)) {
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

  /*
   * Newest first: the conversation the user just held is the one they look for. The server list
   * may arrive in any order, so sort on the summary timestamp rather than trusting it.
   */
  const sortedRemote = [...remoteResult.data].sort(
    (a, b) => (Date.parse(b.timestamp ?? '') || 0) - (Date.parse(a.timestamp ?? '') || 0),
  );

  let pulledThisPass = 0;

  for (const summary of sortedRemote) {
    if (localIds.includes(summary.id)) {
      continue;
    }

    if (pulledThisPass >= batchSize) {
      result.pending.push(summary.id);

      continue;
    }

    const remote = await getHistory(summary.id);

    if (!remote.ok || !remote.data) {
      /*
       * A download that failed (too large for the window, network drop) is not "nothing to do":
       * it is retried on the next pass instead of being silently skipped forever.
       */
      result.failed += 1;
      result.pending.push(summary.id);

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

    try {
      await cacheServerCopy(database, remote.data, summary.urlId ?? summary.id);
      result.pulled += 1;
      pulledThisPass += 1;
    } catch (error) {
      // Not counted as pulled: a pull that did not land is not a pull.
      result.failed += 1;
      result.pending.push(summary.id);
      logger.debug('could not cache a server chat', error);
    }
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
    /*
     * The cached promise still holds the old copy otherwise: the chat opened stale, and its
     * next save re-uploaded the old turns over the ones made on the other device.
     */
    await cacheServerCopy(database, remote.data, id, local.urlId);
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

/*
 * Fingerprint of the last state the server accepted, per chat. The same conversation was
 * re-uploaded whole (≈1 MB for a long Agent project) by every save path — reconcile at
 * startup, description edits, end-of-turn saves — even when nothing had changed.
 */
const lastPushedFingerprint = new Map<string, string>();

/** Cheap, stable fingerprint (length + FNV-1a) of a serialized chat. */
export function chatFingerprint(chat: ChatHistoryItem): string {
  const json = JSON.stringify(chat);

  let hash = 0x811c9dc5;

  for (let index = 0; index < json.length; index++) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${json.length}:${(hash >>> 0).toString(16)}`;
}

/** Test hook: forget what was pushed. */
export function resetPushFingerprints() {
  lastPushedFingerprint.clear();
}

/**
 * Push one conversation to the server after it changed locally.
 *
 * `database` lets a 410 (deleted by this account on another device) remove the local copy
 * instead of leaving it to be pushed again on every save.
 */
export function pushChat(chat: ChatHistoryItem, database?: IDBDatabase): Promise<boolean> {
  const key = chat.id;

  if (isDeleted(chat.id, chat.urlId)) {
    return Promise.resolve(false);
  }

  pendingPush.set(key, chat);

  const previous = pushChains.get(key) ?? Promise.resolve(true);

  const run: Promise<boolean> = previous.then(async (previousResult) => {
    const latest = pendingPush.get(key);

    if (!latest) {
      // A newer call already sent this state (or a newer one); report how that went.
      return previousResult;
    }

    pendingPush.delete(key);

    /*
     * A queued save may have been superseded by deletion while its predecessor was in flight.
     * Re-check immediately before the network write, not only when pushChat is called.
     */
    if (isDeleted(latest.id, latest.urlId)) {
      return false;
    }

    const fingerprint = chatFingerprint(latest);

    if (lastPushedFingerprint.get(key) === fingerprint) {
      return true;
    }

    try {
      const response = await putHistory(latest);

      if (response.status === 410) {
        pendingPush.delete(key);

        if (database) {
          await deleteLocalCopy(database, latest.id, latest.urlId);
        } else {
          markDeleted(latest.id, latest.urlId);
        }

        return false;
      }

      if (response.ok) {
        lastPushedFingerprint.set(key, fingerprint);
      }

      return response.ok;
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

/**
 * Rename a chat everywhere.
 *
 * The rename used to keep the record's old timestamp, skip the cache and never push: the
 * old name came back from the cache on the next open, or from the server on the next sync,
 * and no other device ever saw the new one.
 */
export async function renameChat(database: IDBDatabase, id: string, description: string): Promise<ChatHistoryItem> {
  const chat = await getMessagesByIdRaw(database, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  const updated: ChatHistoryItem = { ...chat, description, timestamp: new Date().toISOString() };

  await setMessages(
    database,
    updated.id,
    updated.messages,
    updated.urlId,
    updated.description,
    updated.timestamp,
    updated.metadata,
  );
  invalidate(updated.id, updated.urlId);
  void pushChat(updated, database);

  return updated;
}
