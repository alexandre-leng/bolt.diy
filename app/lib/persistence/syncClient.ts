import type { ChatHistoryItem } from './useChatHistory';
import { createScopedLogger } from '~/utils/logger';

/*
 * Client for bolt-history, the server-side store that makes one profile share its chat
 * history between phone and desktop.
 *
 * History normally lives in IndexedDB, i.e. in one browser: a conversation started on the
 * desktop simply does not exist on the phone. IndexedDB stays as a fast local cache and
 * this client is the source of truth across devices.
 *
 * Every call fails soft: if the server is unreachable the app keeps working from the local
 * cache rather than showing an error the user can do nothing about. The caller learns what
 * happened from the return value, never from a thrown exception.
 */
const logger = createScopedLogger('HistorySync');

const BASE = '/api/history';

/**
 * Read timeout for the LIST. A slow sync must never delay rendering the local history, but the
 * list itself is small: 8 s is generous for it.
 */
const TIMEOUT_MS = 8000;

/**
 * Read timeout for ONE conversation.
 *
 * Measured in production: `/api/history/<id>` answered 200 after streaming 1.6 MB, and the next
 * large conversation missed the 8 s window. The abort took the whole sync down with it, so the
 * panel showed "Aucune conversation" for an account holding 28 chats. A single conversation is
 * a download, not a page: give it the same budget as a save, and let the batch logic decide how
 * many to fetch per pass.
 */
const CHAT_TIMEOUT_MS = 45_000;

/*
 * A save is a background upload, not a read the UI waits on. With the read timeout, a 1 MB
 * conversation on a slow uplink was aborted at 8 s on every save (nginx logged 408s) and only
 * reached the server when a smaller turn happened to fit.
 */
const SAVE_TIMEOUT_MS = 45_000;

/** Below this size compression costs more than it saves. */
const GZIP_THRESHOLD_BYTES = 16 * 1024;

/**
 * Gzip a save body when the browser can (CompressionStream: every current browser).
 *
 * Conversation JSON is highly repetitive (tool calls, progress events, re-sent file
 * contents): ~1 MB compresses to ~100 KB. Small bodies and older browsers send plain JSON;
 * bolt-history accepts both.
 */
export async function encodeSaveBody(json: string): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  if (json.length < GZIP_THRESHOLD_BYTES || typeof CompressionStream === 'undefined') {
    return { body: json, headers: {} };
  }

  try {
    // Response(...).body rather than Blob.stream(): same stream in browsers, wider support.
    const source = new Response(json).body;

    if (!source) {
      return { body: json, headers: {} };
    }

    const stream = source.pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).arrayBuffer();

    return { body: compressed, headers: { 'Content-Encoding': 'gzip' } };
  } catch (error) {
    logger.debug('gzip unavailable, sending plain JSON', error);

    return { body: json, headers: {} };
  }
}

export interface SyncResult<T> {
  ok: boolean;
  data?: T;
  error?: string;

  /** HTTP status when the server answered; 410 on a PUT means the chat was deleted. */
  status?: number;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<SyncResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
    });

    if (!response.ok) {
      // 401 means the session expired; the app's normal auth flow handles it.
      return { ok: false, error: `HTTP ${response.status}`, status: response.status };
    }

    return { ok: true, data: (await response.json()) as T, status: response.status };
  } catch (error) {
    logger.debug('history sync unavailable', error);

    return { ok: false, error: error instanceof Error ? error.message : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Chat list without messages: enough to render the projects list cheaply. */
export type ChatSummary = Omit<ChatHistoryItem, 'messages'>;

/** A chat this account deleted (on any device), as listed by the server. */
export interface ChatTombstone {
  id: string;
  urlId?: string | null;
  deletedAt?: string;
}

export async function listHistory(): Promise<SyncResult<ChatSummary[]> & { deleted?: ChatTombstone[] }> {
  const result = await request<{ ok: boolean; chats: ChatSummary[]; deleted?: ChatTombstone[] }>(BASE);

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error };
  }

  /*
   * Tombstones let a deletion reach the other devices; an older server does not send the
   * field, which must simply mean "nothing deleted".
   */
  const deleted = Array.isArray(result.data.deleted)
    ? result.data.deleted.filter((entry) => entry && typeof entry.id === 'string')
    : [];

  return { ok: true, data: result.data.chats ?? [], deleted };
}

export async function getHistory(id: string): Promise<SyncResult<ChatHistoryItem>> {
  const result = await request<{ ok: boolean; chat: ChatHistoryItem }>(
    `${BASE}/${encodeURIComponent(id)}`,
    {},
    CHAT_TIMEOUT_MS,
  );

  if (!result.ok || !result.data?.chat) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data.chat };
}

/** Create or replace a chat. Idempotent: replaying the same call never duplicates it. */
export async function putHistory(chat: ChatHistoryItem): Promise<SyncResult<null>> {
  const { body, headers } = await encodeSaveBody(JSON.stringify(chat));

  const result = await request<{ ok: boolean }>(
    `${BASE}/${encodeURIComponent(chat.id)}`,
    { method: 'PUT', body, headers },
    SAVE_TIMEOUT_MS,
  );

  return { ok: result.ok, error: result.error, status: result.status };
}

export async function deleteHistory(id: string): Promise<SyncResult<null>> {
  const result = await request<{ ok: boolean }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });

  return { ok: result.ok, error: result.error };
}

/**
 * Pick which copy to keep.
 *
 * One user, two devices: the newest timestamp wins. There is deliberately no field-level
 * merge — mixing messages from two divergent copies produces a conversation neither device
 * ever had.
 */
export function pickNewest<T extends { timestamp?: string; messages?: unknown }>(
  local?: T,
  remote?: T,
): 'local' | 'remote' | 'none' {
  if (!local && !remote) {
    return 'none';
  }

  if (!remote) {
    return 'local';
  }

  if (!local) {
    return 'remote';
  }

  const localCount = countMessages(local);
  const remoteCount = countMessages(remote);

  /*
   * An empty copy must never overwrite a populated one, whatever the clocks say.
   *
   * A blank record with a fresh timestamp — a test fixture, a half-written push, a
   * conversation whose messages failed to upload — otherwise replaces the real
   * conversation on every device, and the project loses its files (the preview then
   * has nothing to render). Ordering by timestamp alone cannot express this: the
   * empty copy legitimately looks "newer".
   */
  if (remoteCount === 0 && localCount > 0) {
    return 'local';
  }

  if (localCount === 0 && remoteCount > 0) {
    return 'remote';
  }

  const localTime = Date.parse(local.timestamp ?? '') || 0;
  const remoteTime = Date.parse(remote.timestamp ?? '') || 0;

  return remoteTime > localTime ? 'remote' : 'local';
}

/**
 * Both copies carry the same version: nothing to transfer either way.
 *
 * pickNewest keeps the local copy on a tie, which is right for display but made the sync
 * re-upload every already-synchronised chat in full each time the sidebar opened.
 */
export function sameVersion(local?: { timestamp?: string }, remote?: { timestamp?: string }): boolean {
  if (!local || !remote) {
    return false;
  }

  const localTime = Date.parse(local.timestamp ?? '');

  return !isNaN(localTime) && localTime === Date.parse(remote.timestamp ?? '');
}

/** Message count of a chat-like object, tolerating the summary shape (no `messages`). */
function countMessages(chat: object): number {
  const value = (chat as { messages?: unknown }).messages;

  return Array.isArray(value) ? value.length : -1;
}
