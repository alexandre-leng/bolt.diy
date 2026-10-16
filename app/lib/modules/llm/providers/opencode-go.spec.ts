import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenCodeGoProvider, { opencodeGoProtocol, sessionScope, shouldDisableThinking } from './opencode-go';

/** Capture the request the provider sends, then fail it: only the request matters here. */
async function captureRequest(model: string, sessionKey?: string) {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      throw new Error('captured');
    }),
  );

  const instance = new OpenCodeGoProvider().getModelInstance({
    model,
    serverEnv: {} as Env,
    apiKeys: { OpenCodeGo: 'test-key' },
    providerSettings: sessionKey ? { OpenCodeGo: { sessionKey } } : undefined,
  });

  await generateText({ model: instance, prompt: 'hi', maxRetries: 0 }).catch(() => undefined);

  return seen[0];
}

describe('OpenCode Go provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives each conversation its own stable session, not one per model for everybody', async () => {
    // Before: every account and every chat shared `bolt-diy-<model>`.
    expect(sessionScope('deepseek-v4.1-flash', 'chat-A')).not.toBe(sessionScope('deepseek-v4.1-flash', 'chat-B'));
    expect(sessionScope('deepseek-v4.1-flash', 'chat-A')).toBe(sessionScope('deepseek-v4.1-flash', 'chat-A'));

    const request = await captureRequest('deepseek-v4.1-flash', '1-1792164125491');
    expect(request.headers['x-opencode-session']).toBe(sessionScope('deepseek-v4.1-flash', '1-1792164125491'));
    expect(request.headers['x-opencode-session']).not.toContain('1792164125491');
  });

  it('does not disable thinking on a thinking-only model (the gateway answers 400)', async () => {
    expect(shouldDisableThinking('glm-5.3')).toBe(false);
    expect((await captureRequest('glm-5.3')).body.thinking).toBeUndefined();

    // Unchanged for the models that need it to return tool calls.
    expect((await captureRequest('deepseek-v4.1-flash')).body.thinking).toEqual({ type: 'disabled' });
  });

  it('resends without `thinking` when the upstream refuses that field', async () => {
    const bodies: Record<string, unknown>[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        bodies.push(body);

        if (body.thinking) {
          return new Response(
            JSON.stringify({ error: { message: 'invalid request body: json: unknown field "thinking"' } }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }

        throw new Error('captured');
      }),
    );

    const instance = new OpenCodeGoProvider().getModelInstance({
      model: 'glm-5.3-flash',
      serverEnv: {} as Env,
      apiKeys: { OpenCodeGo: 'test-key' },
    });

    await generateText({ model: instance, prompt: 'hi', maxRetries: 0 }).catch(() => undefined);

    // Before: the 400 was final and every turn on that model failed.
    expect(bodies.map((body) => 'thinking' in body)).toEqual([true, false]);
  });

  it('talks to GPT and Grok on /responses and to Claude on /messages', async () => {
    expect(opencodeGoProtocol('gpt-5.6-luna')).toBe('responses');
    expect(opencodeGoProtocol('grok-4.7')).toBe('responses');
    expect(opencodeGoProtocol('claude-haiku-5-5')).toBe('messages');
    expect(opencodeGoProtocol('deepseek-v4.1-flash')).toBe('chat');

    expect((await captureRequest('gpt-5.6-luna')).url).toMatch(/\/responses$/);
    expect((await captureRequest('claude-haiku-5-5')).url).toMatch(/\/messages$/);
    expect((await captureRequest('qwen3.8-max')).url).toMatch(/\/chat\/completions$/);
  });
});
