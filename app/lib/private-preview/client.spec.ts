import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPrivatePreview } from './client';

describe('requestPrivatePreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a ready state with a same-origin URL when the build succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, url: '/private-preview/abc123/' }), { status: 200 })),
    );

    const result = await requestPrivatePreview({ 'index.html': '<h1>x</h1>' }, true);

    expect(result).toEqual({ status: 'ready', url: '/private-preview/abc123/' });
  });

  it('never returns a link when the build failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'build failed' }), { status: 422 })),
    );

    const result = await requestPrivatePreview({ 'index.html': '<h1>x</h1>' }, true);

    expect(result.status).toBe('error');
    expect(result).not.toHaveProperty('url');
  });

  it('reports a network failure as an error, not a ready preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const result = await requestPrivatePreview({ 'index.html': '<h1>x</h1>' }, false);

    expect(result.status).toBe('error');
  });

  it('posts the files to the session-protected endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, url: '/private-preview/x/' })));
    vi.stubGlobal('fetch', fetchMock);

    await requestPrivatePreview({ 'index.html': 'a' }, false);

    expect(fetchMock).toHaveBeenCalledWith('/api/private-preview', expect.objectContaining({ method: 'POST' }));
  });
});
