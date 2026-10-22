import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('~/lib/.server/codex-oauth', () => ({
  codexAuth: async () => null,
  CODEX_BASE_URL: '',
  codexHeaders: () => ({}),
}));
afterEach(() => vi.unstubAllGlobals());

async function post(body: unknown, env: Record<string, string> = {}) {
  vi.resetModules();

  const { action } = await import('./api.screenshot.designs');

  return action({
    request: new Request('https://bolt.example/api/screenshot/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context: { cloudflare: { env } },
  } as never);
}

describe('design direction forwarding', () => {
  it('forwards the selected direction to the private image service', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ images: ['aGVsbG8='] }));
    vi.stubGlobal('fetch', fetcher);

    const response = await post(
      { prompt: 'Pagia landing', count: 1, directionIndex: 2 },
      {
        DESIGN_API_URL: 'http://service.internal',
        DESIGN_API_INTERNAL_TOKEN: 'test-token',
      },
    );
    expect(response.status).toBe(200);

    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ prompt: 'Pagia landing', count: 1, directionIndex: 2 });
  });
  it('rejects a direction outside the fixed list', async () => {
    const response = await post({ prompt: 'Pagia landing', count: 1, directionIndex: 4 });
    expect(response.status).toBe(400);
  });
  it('rejects a batch that exceeds the available direction slots', async () => {
    const response = await post({ prompt: 'Pagia landing', count: 3, directionIndex: 2 });
    expect(response.status).toBe(400);
  });
});
