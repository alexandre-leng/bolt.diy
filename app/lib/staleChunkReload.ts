/*
 * After a deployment, a tab opened on the previous build still references the
 * old hashed chunks (e.g. Workbench.client-<hash>.js). They no longer exist, so
 * opening the workbench/preview fails with a 404 on a dynamic import. Vite
 * signals this with `vite:preloadError`: reload once to pick up the new build.
 * A 30 s guard prevents a reload loop if the chunk is genuinely missing.
 */
export const RELOAD_KEY = 'bolt_stale_chunk_reload_at';

const GUARD_MS = 30_000;

export function handlePreloadError(
  event: Event,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  reload: () => void,
  now = Date.now(),
): boolean {
  const last = Number(storage.getItem(RELOAD_KEY) || 0);

  if (now - last < GUARD_MS) {
    // Already reloaded moments ago: let the error surface instead of looping.
    return false;
  }

  event.preventDefault();
  storage.setItem(RELOAD_KEY, String(now));
  reload();

  return true;
}

export function installStaleChunkReload() {
  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('vite:preloadError', (event) => {
    handlePreloadError(event, window.sessionStorage, () => window.location.reload());
  });
}
