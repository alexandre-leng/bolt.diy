import { afterEach, describe, expect, it, vi } from 'vitest';
import { action } from './api.web-search';

/*
 * The caught upstream error's `.message` was returned verbatim, leaking the resolved
 * host/URL the server attempted (SSRF reconnaissance). The response must be generic while the
 * full message stays in the server log; the 504/502 split is still derived internally.
 */
function fetchOp(url: string) {
  return action({
    request: new Request('https://bolt.example/api/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-proto': 'https', 'x-real-ip': '198.51.100.7' },
      body: JSON.stringify({ url }),
    }),
    context: {},
  } as never);
}

describe('/api/web-search error disclosure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not echo the upstream URL or host in the error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:8199 while fetching https://internal.example.net/secret');
      }),
    );

    const response = await fetchOp('https://example.com/page');
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);

    // Before: this was the raw message above, host and all.
    expect(body.error).not.toMatch(/127\.0\.0\.1|internal\.example\.net|ECONNREFUSED|8199/);
    expect(body.error).toBe('The upstream request failed. Try again later.');
  });

  it('keeps 504 for a timeout while hiding the internal message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Request timed out after 10 seconds (https://slow.example.net)');
      }),
    );

    const response = await fetchOp('https://example.com/page');
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(504);
    expect(body.error).not.toMatch(/slow\.example\.net|http/);
    expect(body.error).toBe('The upstream request timed out. Try again later.');
  });
});
