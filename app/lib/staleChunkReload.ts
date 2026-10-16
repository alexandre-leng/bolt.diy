/*
 * After a deployment, a tab opened on the previous build still references the
 * old hashed bundles (e.g. Workbench.client-<hash>.js). They no longer exist on
 * the server, so opening the workbench / preview / settings / landing fails with
 * a 404 on a module request. Two different code paths request those chunks:
 *
 *   1. Vite's own dynamic-import helper -> `vite:preloadError`.
 *   2. React Router's route modules (Workbench.client, ControlPanel, Preview...)
 *      loading their exports by URL -> they fetch the file directly and never
 *      emit `vite:preloadError`.
 *
 * Only (1) was handled at first, which is why a stale tab still showed
 * "No preview available" and an empty landing page after a deploy. We now watch
 * module requests for `/assets/*.js` 404s as well, and reload once.
 *
 * A 30 s guard prevents a reload loop when a chunk is genuinely missing.
 */
export const RELOAD_KEY = 'bolt_stale_chunk_reload_at';

const GUARD_MS = 30_000;

/** Matches the hashed bundles emitted by the build, e.g. /assets/Workbench.client-C3-sz4v1.js */
const HASHED_BUNDLE = /\/assets\/[^/?]+\.js(?:\?|$)/;

export function isStaleBundleUrl(url: string, status: number): boolean {
  return status === 404 && HASHED_BUNDLE.test(url);
}

export function shouldReloadForStaleChunk(storage: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()): boolean {
  const last = Number(storage.getItem(RELOAD_KEY) || 0);

  if (now - last < GUARD_MS) {
    // Already reloaded moments ago: let the error surface instead of looping.
    return false;
  }

  storage.setItem(RELOAD_KEY, String(now));

  return true;
}

export function handlePreloadError(
  event: Event,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  reload: () => void,
  now = Date.now(),
): boolean {
  if (!shouldReloadForStaleChunk(storage, now)) {
    return false;
  }

  event.preventDefault();
  reload();

  return true;
}

export function installStaleChunkReload(reload: () => void = () => window.location.reload()) {
  if (typeof window === 'undefined') {
    return;
  }

  const storage = window.sessionStorage;

  window.addEventListener('vite:preloadError', (event) => {
    handlePreloadError(event, storage, reload);
  });

  /*
   * Route modules are fetched by the router, not by Vite's helper: catch the
   * 404 on the response itself. `fetch` is wrapped for GETs only; anything else
   * (chat streams, uploads) is passed straight through untouched.
   */
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    const method = (
      init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    ).toUpperCase();

    const response = await originalFetch(input, init);

    if (method === 'GET' && response.status === 404 && isStaleBundleUrl(url, response.status)) {
      if (shouldReloadForStaleChunk(storage)) {
        reload();
      }
    }

    return response;
  };

  // Some bundles are requested by a <script type="module"> tag instead.
  document.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLScriptElement | null;

      if (
        target?.tagName === 'SCRIPT' &&
        target.src &&
        HASHED_BUNDLE.test(target.src) &&
        shouldReloadForStaleChunk(storage)
      ) {
        reload();
      }
    },
    true,
  );
}
