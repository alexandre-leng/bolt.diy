/**
 * Cross-origin isolation mode for this browser — must match the
 * `Cross-Origin-Embedder-Policy` header nginx sends (see
 * /opt/bolt/auth/nginx-bolt.conf, maps `$bolt_coep_ua` / `$bolt_coep`).
 *
 * Firefox for Android ignores COEP `credentialless` (supported on desktop
 * only), so with it the page is never `crossOriginIsolated` and WebContainer
 * fails with "The WebAssembly.Memory object cannot be serialized". Those
 * browsers get `require-corp`, both for the page and for the WebContainer
 * frames booted with the same value.
 */
export type CoepMode = 'credentialless' | 'require-corp';

const FIREFOX_ANDROID = /Android.*Firefox\//i;

export function detectCoepMode(userAgent: string, cookie = ''): CoepMode {
  // Manual override for testing, same cookie as nginx: bolt_coep=rc | cl
  const forced = /(?:^|;\s*)bolt_coep=(rc|cl)(?:;|$)/.exec(cookie)?.[1];

  if (forced === 'rc') {
    return 'require-corp';
  }

  if (forced === 'cl') {
    return 'credentialless';
  }

  return FIREFOX_ANDROID.test(userAgent) ? 'require-corp' : 'credentialless';
}

export function currentCoepMode(): CoepMode {
  if (typeof navigator === 'undefined') {
    return 'credentialless';
  }

  return detectCoepMode(navigator.userAgent, typeof document === 'undefined' ? '' : document.cookie);
}

/*
 * WebContainer serves each preview on a per-mode host:
 *   credentialless -> https://<id>.local-credentialless.webcontainer-api.io
 *   require-corp   -> https://<id>.local-corp.webcontainer-api.io
 * Upstream hard-coded the first one in four places, so on Firefox Android
 * (require-corp) the preview id was never found: no refresh on file change,
 * "Open in new window" silently did nothing, /webcontainer/preview/:id pointed
 * at the wrong host.
 */
const PREVIEW_HOST = /^https?:\/\/([^.]+)\.local-(?:credentialless|corp)\.webcontainer-api\.io/;

/*
 * Server runtime (bolt-runtime): previews live on a pool of hostnames next to the app,
 * `https://p<N>.<parent of the app host>` (e.g. p3.169-58-18-46.sslip.io next to
 * bolt.169-58-18-46.sslip.io). The preview id is the `p<N>` label.
 */
const SERVER_PREVIEW_HOST = /^https:\/\/(p\d{1,3})\.([a-z0-9.-]+?)(?::\d+)?(?:[/?#]|$)/i;

function appParentDomain(): string | null {
  if (typeof location === 'undefined') {
    return null;
  }

  const parent = location.hostname.split('.').slice(1).join('.');

  return parent || null;
}

export function parsePreviewId(url: string): string | null {
  const legacy = PREVIEW_HOST.exec(url)?.[1];

  if (legacy) {
    return legacy;
  }

  const server = SERVER_PREVIEW_HOST.exec(url);
  const parent = appParentDomain();

  if (server && (!parent || server[2].toLowerCase() === parent.toLowerCase())) {
    return server[1].toLowerCase();
  }

  return null;
}

export function previewOrigin(previewId: string, mode: CoepMode = currentCoepMode()): string {
  if (/^p\d{1,3}$/i.test(previewId)) {
    const parent = appParentDomain();

    if (parent) {
      return `https://${previewId.toLowerCase()}.${parent}`;
    }
  }

  return `https://${previewId}.local-${mode === 'require-corp' ? 'corp' : 'credentialless'}.webcontainer-api.io`;
}
