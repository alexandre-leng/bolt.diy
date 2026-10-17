import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader } from './api.git-proxy.$';

function proxy(path: string, headers: Record<string, string> = {}) {
  return loader({
    request: new Request(`https://bolt.example/api/git-proxy/${path}`, { headers }),
    params: { '*': path },
    context: {},
  } as never);
}

describe('/api/git-proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses hosts outside the git allowlist without making a request', async () => {
    const fetchMock = vi.fn(async () => new Response('internal'));
    vi.stubGlobal('fetch', fetchMock);

    for (const path of ['host.docker.internal/x', 'bolt-history:8200/history', '169.254.169.254/latest/meta-data']) {
      const response = await proxy(path);
      expect(response.status, path).toBe(403);
    }

    // Before: every one of these was fetched (SSRF from the server).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow a redirect off the allowlist', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await proxy('github.com/user/repo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual' });
  });

  it('proxies an allowed git host and never logs the authorization header', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const fetchMock = vi.fn(
      async () => new Response('refs', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await proxy('github.com/user/repo.git/info/refs', { authorization: 'Basic SECRET-TOKEN' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('refs');

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(new Headers(init.headers).get('authorization')).toBe('Basic SECRET-TOKEN');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-TOKEN');
  });
});
