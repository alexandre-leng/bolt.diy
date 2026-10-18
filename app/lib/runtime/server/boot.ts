import { RuntimeSocket } from './client';
import { ServerContainer } from './serverContainer';

const DRAFT_KEY = 'bolt_runtime_draft';
const COOKIE_REFRESH_MS = 6 * 3600 * 1000;
const PREVIEW_ORIGIN = /^https:\/\/p\d{1,3}\.[a-z0-9.-]+$/i;

function randomId(bytes = 12): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The server project a tab works in. A conversation URL maps to `chat-<id>` (so a reload reopens
 * the same sandbox, files already there); a new project starts as a per-tab draft.
 */
export function projectIdFor(pathname: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  const chat = /^\/chat\/([^/?#]+)/.exec(pathname)?.[1];

  if (chat) {
    const safe = decodeURIComponent(chat)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/\.\.+/g, '_')
      .slice(0, 90);

    if (safe) {
      return `chat-${safe}`;
    }
  }

  let draft = storage?.getItem(DRAFT_KEY) ?? null;

  if (!draft || !/^draft-[A-Za-z0-9_-]{8,40}$/.test(draft)) {
    draft = `draft-${randomId(9)}`;
    storage?.setItem(DRAFT_KEY, draft);
  }

  return draft;
}

/** Same-site preview hosts only; anything else posting to Bolt is ignored. */
export function isPreviewOrigin(origin: string, appHost: string): boolean {
  if (!PREVIEW_ORIGIN.test(origin)) {
    return false;
  }

  const parent = appHost.split('.').slice(1).join('.');

  return parent.length > 0 && origin.toLowerCase().endsWith(`.${parent.toLowerCase()}`);
}

async function refreshPreviewCookie(): Promise<void> {
  try {
    const response = await fetch('/api/runtime/preview-cookie', { credentials: 'same-origin', cache: 'no-store' });

    if (!response.ok) {
      console.warn(`[runtime] preview cookie: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn('[runtime] preview cookie failed', error);
  }
}

export async function bootServerContainer(): Promise<ServerContainer> {
  await refreshPreviewCookie();
  setInterval(() => void refreshPreviewCookie(), COOKIE_REFRESH_MS);

  let storage: Storage | null = null;

  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }

  const socket = new RuntimeSocket({
    url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/runtime`,
    projectId: projectIdFor(location.pathname, storage),

    /*
     * Per page load: a reload is a new tab for the server (its old processes end), while a
     * network blip reconnects with this id and keeps the terminal and dev server running.
     */
    clientId: randomId(18),
    onState: (state, detail) => {
      if (state !== 'open') {
        console.info(`[runtime] ${state}${detail ? `: ${detail}` : ''}`);
      }
    },
  });

  const container = new ServerContainer(socket);

  /*
   * The tab's sandbox follows the page: a new project is a draft until its first message gives
   * it a conversation URL (the draft directory is then renamed, files and dev server kept), and
   * opening another conversation swaps the project directory in the same sandbox.
   */
  container.projectResolver = () => projectIdFor(location.pathname, storage);

  container.onDraftAdopted = () => {
    try {
      storage?.removeItem(DRAFT_KEY);
    } catch {
      // storage unavailable
    }
  };

  const follow = () => {
    void container.followLocation().catch((error) => console.warn('[runtime] project switch failed', error));
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);

    history[method] = (...args: Parameters<History['pushState']>) => {
      const before = location.pathname;
      original(...args);

      if (location.pathname !== before) {
        follow();
      }
    };
  }

  window.addEventListener('popstate', follow);

  window.addEventListener('message', (event) => {
    const data = event.data as { __bolt?: number; type?: string } | null;

    if (data && data.__bolt === 1 && typeof data.type === 'string' && isPreviewOrigin(event.origin, location.host)) {
      const { __bolt: _marker, ...message } = data;
      container.emitPreviewMessage(message);
    }
  });

  await socket.ready;

  return container;
}
