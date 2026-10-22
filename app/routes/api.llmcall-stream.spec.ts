import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { action as enhancerAction } from './api.enhancer';
import { action as llmCallAction } from './api.llmcall';

/*
 * Both routes stream plain text. They used to answer 200 with an EMPTY body whenever the
 * provider failed (textStream drops `error` parts): the enhancer then replaced the user's
 * prompt with nothing, and /api/llmcall returned silence.
 */

const context = { clientAddress: '127.0.0.1' };

function call(action: typeof llmCallAction, body: unknown, method = 'POST') {
  return action({
    request: new Request('https://bolt.example/api/llmcall', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    context,
    params: {},
  } as never);
}

const okStream = () =>
  new Response('data: {"choices":[{"index":0,"delta":{"content":"enhanced"}}]}\n\ndata: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });

const providerFailure = () =>
  new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

const llmCallBody = {
  message: 'hello',
  model: 'deepseek-v4.1-flash',
  provider: { name: 'OpenCodeGo' },
  streamOutput: true,
};

const enhancerBody = {
  message: 'make this prompt better',
  model: 'deepseek-v4.1-flash',
  provider: { name: 'OpenCodeGo' },
};

/**
 * The routes resolve the operator's keys through the accounts service, which is not running in
 * this test process. Answering that one lookup keeps the cases on the provider path they test:
 * without it the resolver fails closed and every case would read a 503.
 */
function effectiveKeys() {
  return Response.json({
    apiKeys: { OpenCodeGo: 'test-key' },
    baseUrls: {},
    allowUserKeys: [],
    source: { OpenCodeGo: 'instance' },
    policy: {
      defaultModel: { provider: '', model: '' },
      allowedProviders: [],
      allowedModels: {},
      effortPolicy: 'free',
    },
  });
}

function stubProvider(handler: () => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/internal/effective-keys') ? effectiveKeys() : handler(),
    ),
  );
}

describe('streaming model routes', () => {
  beforeEach(() => vi.stubEnv('OPENCODE_GO_API_KEY', 'test-key'));

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('/api/llmcall streams the text when the provider answers', async () => {
    stubProvider(async () => okStream());

    const response = await call(llmCallAction, llmCallBody);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('enhanced');
  }, 30_000);

  it('/api/llmcall answers with a real error status when the provider rejects the request', async () => {
    stubProvider(async () => providerFailure());

    const response = await call(llmCallAction, llmCallBody);

    // Before: 200 with an empty body — the failure was invisible to the client.
    expect(response.status).not.toBe(200);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toMatch(/error/i);
  }, 30_000);

  it('/api/enhancer streams the enhanced prompt when the provider answers', async () => {
    stubProvider(async () => okStream());

    const response = await call(enhancerAction as typeof llmCallAction, enhancerBody);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('enhanced');
  }, 30_000);

  it('/api/enhancer reports the provider failure instead of streaming an empty 200', async () => {
    stubProvider(async () => providerFailure());

    const response = await call(enhancerAction as typeof llmCallAction, enhancerBody);
    const body = await response.text();

    // Before: 200, body empty — the enhancer wiped the prompt in the composer.
    expect(response.status).not.toBe(200);
    expect(body.length).toBeGreaterThan(0);
  }, 30_000);

  it('/api/enhancer is wrapped in withSecurity (method check, security headers)', async () => {
    const response = await call(enhancerAction as typeof llmCallAction, enhancerBody, 'GET');

    // Before: unwrapped, so it parsed (and failed) the empty body as a 400.
    expect(response.status).toBe(405);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  }, 30_000);
});
