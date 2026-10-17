import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';

// Allowed headers to forward to the target server
const ALLOW_HEADERS = [
  'accept-encoding',
  'accept-language',
  'accept',
  'access-control-allow-origin',
  'authorization',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'dnt',
  'pragma',
  'range',
  'referer',
  'user-agent',
  'x-authorization',
  'x-http-method-override',
  'x-requested-with',
];

// Headers to expose from the target server's response
const EXPOSE_HEADERS = [
  'accept-ranges',
  'age',
  'cache-control',
  'content-length',
  'content-language',
  'content-type',
  'date',
  'etag',
  'expires',
  'last-modified',
  'pragma',
  'server',
  'transfer-encoding',
  'vary',
  'x-github-request-id',
  'x-redirected-url',
];

/*
 * Git hosts this proxy may reach. It used to forward to ANY `https://<domain>` (including
 * internal names and, through followed redirects, any http URL), with the caller's
 * `authorization` header logged in clear. Override with GIT_PROXY_ALLOWED_HOSTS
 * (comma-separated; each entry also allows its subdomains) for a self-hosted forge.
 */
const DEFAULT_ALLOWED_GIT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];
const MAX_REDIRECTS = 5;

function allowedGitHosts(): string[] {
  const configured = typeof process !== 'undefined' ? process.env?.GIT_PROXY_ALLOWED_HOSTS : undefined;

  const hosts = configured
    ?.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return hosts && hosts.length > 0 ? hosts : DEFAULT_ALLOWED_GIT_HOSTS;
}

/** True for an https URL, default port, no credentials, on an allowed host or its subdomain. */
function isAllowedGitUrl(target: URL): boolean {
  if (target.protocol !== 'https:' || target.port !== '' || target.username || target.password) {
    return false;
  }

  const host = target.hostname.toLowerCase();

  return allowedGitHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// Handle all HTTP methods
export async function action({ request, params }: ActionFunctionArgs) {
  return handleProxyRequest(request, params['*']);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return handleProxyRequest(request, params['*']);
}

async function handleProxyRequest(request: Request, path: string | undefined) {
  try {
    if (!path) {
      return Response.json({ error: 'Invalid proxy URL format' }, { status: 400 });
    }

    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': ALLOW_HEADERS.join(', '),
          'Access-Control-Expose-Headers': EXPOSE_HEADERS.join(', '),
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Extract domain and remaining path
    const parts = path.match(/([^\/]+)\/?(.*)/);

    if (!parts) {
      return Response.json({ error: 'Invalid path format' }, { status: 400 });
    }

    const domain = parts[1];
    const remainingPath = parts[2] || '';

    // Reconstruct the target URL with query parameters
    const url = new URL(request.url);

    let target: URL;

    try {
      target = new URL(`https://${domain}/${remainingPath}${url.search}`);
    } catch {
      return Response.json({ error: 'Invalid proxy URL format' }, { status: 400 });
    }

    if (target.host.toLowerCase() !== domain.toLowerCase() || !isAllowedGitUrl(target)) {
      return Response.json({ error: 'This git host is not allowed' }, { status: 403 });
    }

    // Host only: the path/query may carry tokens.
    console.log('Git proxy:', request.method, target.hostname);

    // Filter and prepare headers
    const headers = new Headers();

    // Only forward allowed headers
    for (const header of ALLOW_HEADERS) {
      if (request.headers.has(header)) {
        headers.set(header, request.headers.get(header)!);
      }
    }

    // Set the host header
    headers.set('Host', domain);

    // Set Git user agent if not already present
    if (!headers.has('user-agent') || !headers.get('user-agent')?.startsWith('git/')) {
      headers.set('User-Agent', 'git/@isomorphic-git/cors-proxy');
    }

    /*
     * `duplex` is required by undici/Node when streaming a request body, but it is
     * absent from the Cloudflare `RequestInit` type, so widen it locally.
     */
    const fetchOptions: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,

      // Each hop is checked against the allowlist below; `follow` went anywhere.
      redirect: 'manual',
    };

    // Add body for non-GET/HEAD requests
    if (!['GET', 'HEAD'].includes(request.method)) {
      fetchOptions.body = request.body;
      fetchOptions.duplex = 'half';
    }

    // Forward the request to the target URL, following only redirects to allowed hosts.
    let response = await fetch(target.href, fetchOptions);
    let redirected = false;

    for (let hop = 0; [301, 302, 303, 307, 308].includes(response.status); hop++) {
      const location = response.headers.get('location');
      const next = location ? new URL(location, target) : undefined;

      await response.body?.cancel();

      if (!next || hop >= MAX_REDIRECTS || !isAllowedGitUrl(next) || fetchOptions.body) {
        return Response.json({ error: 'Redirect refused by the git proxy' }, { status: 502 });
      }

      // Never carry the caller's credentials to another host.
      if (next.hostname !== target.hostname) {
        headers.delete('authorization');
        headers.delete('x-authorization');
      }

      headers.set('Host', next.host);
      target = next;
      redirected = true;
      response = await fetch(target.href, fetchOptions);
    }

    console.log('Git proxy response:', response.status);

    // Create response headers
    const responseHeaders = new Headers();

    // Add CORS headers
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', ALLOW_HEADERS.join(', '));
    responseHeaders.set('Access-Control-Expose-Headers', EXPOSE_HEADERS.join(', '));

    // Copy exposed headers from the target response
    for (const header of EXPOSE_HEADERS) {
      // Skip content-length as we'll use the original response's content-length
      if (header === 'content-length') {
        continue;
      }

      if (response.headers.has(header)) {
        responseHeaders.set(header, response.headers.get(header)!);
      }
    }

    // If the response was redirected, add the x-redirected-url header
    if (redirected) {
      responseHeaders.set('x-redirected-url', target.href);
    }

    // Return the response with the target's body stream piped directly
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return Response.json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
        url: path ? `https://${path}` : 'Invalid URL',
      },
      { status: 500 },
    );
  }
}
