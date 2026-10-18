/**
 * Preview addresses of the Bolt runtime: each running dev server is served on a host
 * `pN.<parent domain of the app>` (for bolt.169-58-18-46.sslip.io: p1.169-58-18-46.sslip.io).
 */
const SERVER_PREVIEW_HOST = /^https:\/\/(p\d{1,3})\.([a-z0-9.-]+?)(?::\d+)?(?:[/?#]|$)/i;

function appParentDomain(): string | null {
  if (typeof location === 'undefined') {
    return null;
  }

  const parent = location.hostname.split('.').slice(1).join('.');

  return parent || null;
}

/** `https://p3.example.org/x` -> `p3`; anything else (another domain, a foreign URL) -> null. */
export function parsePreviewId(url: string): string | null {
  const server = SERVER_PREVIEW_HOST.exec(url);
  const parent = appParentDomain();

  if (server && (!parent || server[2].toLowerCase() === parent.toLowerCase())) {
    return server[1].toLowerCase();
  }

  return null;
}

/** `p3` -> `https://p3.<parent domain>`; null for an id that is not a preview slot. */
export function previewOrigin(previewId: string): string | null {
  const parent = appParentDomain();

  if (/^p\d{1,3}$/i.test(previewId) && parent) {
    return `https://${previewId.toLowerCase()}.${parent}`;
  }

  return null;
}
