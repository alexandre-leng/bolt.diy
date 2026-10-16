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

/** Short timeout: a slow sync must never delay rendering the local history. */
const TIMEOUT_MS = 8000;

export interface SyncResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<SyncResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

    if (!response.ok) {
      // 401 means the session expired; the app's normal auth flow handles it.
      return { ok: false, error: `HTTP ${response.status}` };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    logger.debug('history sync unavailable', error);

    return { ok: false, error: error instanceof Error ? error.message : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Chat list without messages: enough to render the projects list cheaply. */
export type ChatSummary = Omit<ChatHistoryItem, 'messages'>;

export async function listHistory(): Promise<SyncResult<ChatSummary[]>> {
  const result = await request<{ ok: boolean; chats: ChatSummary[] }>(BASE);

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data.chats ?? [] };
}

export async function getHistory(id: string): Promise<SyncResult<ChatHistoryItem>> {
  const result = await request<{ ok: boolean; chat: ChatHistoryItem }>(`${BASE}/${encodeURIComponent(id)}`);

  if (!result.ok || !result.data?.chat) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data.chat };
}

/** Create or replace a chat. Idempotent: replaying the same call never duplicates it. */
export async function putHistory(chat: ChatHistoryItem): Promise<SyncResult<null>> {
  const result = await request<{ ok: boolean }>(`${BASE}/${encodeURIComponent(chat.id)}`, {
    method: 'PUT',
    body: JSON.stringify(chat),
  });

  return { ok: result.ok, error: result.error };
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

/** Message count of a chat-like object, tolerating the summary shape (no `messages`). */
function countMessages(chat: object): number {
  const value = (chat as { messages?: unknown }).messages;

  return Array.isArray(value) ? value.length : -1;
}
