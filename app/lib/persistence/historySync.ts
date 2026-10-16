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

export interface Reconciliation {
  /* Pulled from the server because the local copy was missing or older. */
  pulled: number;

  /* Pushed to the server because the local copy was newer. */
  pushed: number;

  /** True when the server could not be reached; the local cache was used as-is. */
  offline: boolean;
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
    const local = await getCachedMessages(database, id).catch(() => undefined);

    if (!local) {
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

    if (pickNewest(local, remote) === 'local') {
      const pushed = await putHistory(local);

      if (pushed.ok) {
        result.pushed += 1;
      }
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

/** Push one conversation to the server after it changed locally. */
export async function pushChat(chat: ChatHistoryItem): Promise<boolean> {
  const result = await putHistory(chat);

  return result.ok;
}
