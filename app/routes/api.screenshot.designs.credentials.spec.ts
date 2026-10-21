import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { action } from './api.screenshot.designs';

/*
 * The image route must be able to spend the ChatGPT SUBSCRIPTION when the deployment carries no
 * platform key: `codex login` writes ~/.codex/auth.json, and that session authenticates against
 * `chatgpt.com/backend-api/codex` with a rotation-prone bearer token, never `api.openai.com`.
 * Before this, the route answered 503 "no OpenAI key" and the whole design-from-prompt mode was
 * dead on this host despite a valid OAuth session.
 */
const AUTH_FILE = join('/tmp', `bolt-codex-auth-${process.pid}.json`);
process.env.CODEX_AUTH_PATH = AUTH_FILE;

/* The host may carry OPENAI_API_KEY for other reasons; this spec owns its credential state. */
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;

/* A JWT whose middle segment decodes: some runtimes validate the header format before decoding. */
function fakeJwt(exp: number) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp, sub: 'test' })).toString('base64url');

  return `${header}.${body}.c2ln`;
}

function post(prompt = 'a landing page for a bakery') {
  return action({
    request: new Request('https://bolt.example/api/screenshot/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ prompt, count: 1 }),
    }),
    context: {},
  } as never);
}

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2w1cAAAAAElFTkSuQmCC';

describe('/api/screenshot/designs credentials', () => {
  it('reports both missing credentials instead of blaming an OpenAI key only', async () => {
    const response = await post();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain('ChatGPT OAuth session');
    expect(body.error).toContain('OpenAI API key');
  });

  it('uses the ChatGPT OAuth session when the deployment has no key', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];

    writeFileSync(
      AUTH_FILE,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
          refresh_token: 'rt.not-used',
          account_id: 'acct-123',
        },
      }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes('auth.openai.com')) {
          /* Rotated pair, access token expired on purpose: the module must persist it before use. */
          return Response.json({
            access_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
            refresh_token: 'rt.1.rotated',
            id_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
          });
        }

        calls.push({ url: String(url), headers: init.headers as Record<string, string> });

        return Response.json({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    try {
      const response = await post();
      const body = (await response.json()) as { images?: string[] };

      expect(response.status).toBe(200);
      expect(body.images?.[0]).toBe(PNG_BASE64);
      expect(calls[0].url).toBe('https://chatgpt.com/backend-api/codex/images/generations');
      expect(calls[0].headers['chatgpt-account-id']).toBe('acct-123');
      expect(calls[0].headers.originator).toBe('codex_cli_rs');
      expect(calls[0].headers.Authorization).toMatch(/^Bearer ey/);
    } finally {
      rmSync(AUTH_FILE, { force: true });
      vi.unstubAllGlobals();
    }
  });

  it('calls the OpenAI images API with a platform key', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), headers: init.headers as Record<string, string> });
        return Response.json({ data: [{ b64_json: PNG_BASE64 }] });
      }),
    );

    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';

    try {
      const response = await post();
      const body = (await response.json()) as { images?: string[] };

      expect(response.status).toBe(200);
      expect(body.images?.[0]).toBe(PNG_BASE64);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
      expect(calls[0].headers.Authorization).toBe('Bearer sk-test-not-a-real-key');
    } finally {
      delete process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
      vi.unstubAllGlobals();
    }
  });
});
