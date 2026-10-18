/**
 * Which runtime runs the user's projects.
 *
 * - `server`: a gVisor sandbox on the Bolt host (bolt-runtime). No StackBlitz domain is contacted.
 * - `webcontainer`: StackBlitz WebContainer in the browser (legacy, kept as a rollback switch).
 *
 * Default comes from the build (`VITE_BOLT_RUNTIME`); a `bolt_runtime=server|wc` cookie overrides it
 * per browser for staged roll-out and tests.
 */
export type RuntimeMode = 'server' | 'webcontainer';

export function resolveRuntimeMode(cookie: string, buildDefault: string | undefined): RuntimeMode {
  const forced = /(?:^|;\s*)bolt_runtime=(server|wc)(?:;|$)/.exec(cookie)?.[1];

  if (forced === 'server') {
    return 'server';
  }

  if (forced === 'wc') {
    return 'webcontainer';
  }

  /*
   * Default: the Bolt server's own sandboxes. `VITE_BOLT_RUNTIME=webcontainer` at build time (or
   * the `bolt_runtime=wc` cookie) brings back StackBlitz WebContainer as a fallback.
   */
  return buildDefault === 'webcontainer' || buildDefault === 'wc' ? 'webcontainer' : 'server';
}

export function currentRuntimeMode(): RuntimeMode {
  const cookie = typeof document === 'undefined' ? '' : document.cookie;

  return resolveRuntimeMode(cookie, import.meta.env.VITE_BOLT_RUNTIME as string | undefined);
}
