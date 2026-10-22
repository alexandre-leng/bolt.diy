import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenCodeGoProvider, {
  effortPayload,
  isThinkingFieldRefusal,
  opencodeGoCanDisableThinking,
  opencodeGoEfforts,
  opencodeGoProtocol,
  sessionScope,
  shouldDisableThinking,
} from './opencode-go';

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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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

  it('retries without `thinking` for that request only, and only when the field itself is refused', async () => {
    const bodies: Record<string, unknown>[] = [];

    let refuse = true;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        bodies.push(body);

        if (body.thinking && refuse) {
          refuse = false;
          return new Response(JSON.stringify({ error: { message: 'json: unknown field "thinking"' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }

        throw new Error('captured');
      }),
    );

    const make = () =>
      new OpenCodeGoProvider().getModelInstance({
        model: 'deepseek-v4.1-flash',
        serverEnv: {} as Env,
        apiKeys: { OpenCodeGo: 'test-key' },
      });

    await generateText({ model: make(), prompt: 'hi', maxRetries: 0 }).catch(() => undefined);
    await generateText({ model: make(), prompt: 'hi', maxRetries: 0 }).catch(() => undefined);

    // Before: the first refusal disabled the injection for every later request in the process.
    expect(bodies.map((body) => 'thinking' in body)).toEqual([true, false, true]);

    expect(isThinkingFieldRefusal('json: unknown field "thinking"')).toBe(true);
    expect(isThinkingFieldRefusal('GLM-5.3 is a thinking-only model; disabling thinking is not supported')).toBe(true);
    expect(isThinkingFieldRefusal('messages[0]: content is empty (thinking about it)')).toBe(false);
  });

  it('never sends the server key to a base URL chosen by the client cookie', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('captured');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OPENCODE_GO_API_KEY', 'server-key');

    const provider = new OpenCodeGoProvider();
    const cookieSettings = { OpenCodeGo: { baseUrl: 'https://attacker.example/v1' } };

    expect(() =>
      provider.getModelInstance({
        model: 'deepseek-v4.1-flash',
        serverEnv: { OPENCODE_GO_API_KEY: 'server-key' } as unknown as Env,
        providerSettings: cookieSettings,
      }),
    ).toThrow(/Missing configuration/);

    expect(
      await provider.getDynamicModels(undefined, cookieSettings.OpenCodeGo, { OPENCODE_GO_API_KEY: 'server-key' }),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    // The server's own endpoint, or the client's own key, keep working.
    const own = provider.getProviderBaseUrlAndKey({
      providerSettings: { baseUrl: 'https://opencode.ai/zen/go/v1/' },
      serverEnv: { OPENCODE_GO_API_KEY: 'server-key' },
      defaultBaseUrlKey: 'OPENCODE_GO_API_BASE_URL',
      defaultApiTokenKey: 'OPENCODE_GO_API_KEY',
    });
    expect(own.apiKey).toBe('server-key');

    const byo = provider.getProviderBaseUrlAndKey({
      apiKeys: { OpenCodeGo: 'client-key' },
      providerSettings: cookieSettings.OpenCodeGo,
      serverEnv: { OPENCODE_GO_API_KEY: 'server-key' },
      defaultBaseUrlKey: 'OPENCODE_GO_API_BASE_URL',
      defaultApiTokenKey: 'OPENCODE_GO_API_KEY',
    });
    expect(byo).toMatchObject({ baseUrl: 'https://attacker.example/v1', apiKey: 'client-key' });
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

  /*
   * The reasoning level chosen in the chat is sent to the gateway. Measured there: DeepSeek and the
   * GPT/Grok family read `thinking`, GLM and the MiMo family read `reasoning_effort` — sending the
   * wrong one is silently ignored, so which field is used matters.
   */
  it('sends the reasoning level the user chose', async () => {
    // A named level: verified live (glm-5.3 reasoning grows from 7 to 427 characters with max).
    expect(effortPayload('glm-5.3', 'max')).toEqual({ thinking: { type: 'enabled', effort: 'max' } });
    expect(effortPayload('deepseek-v4.1-flash', 'high')).toEqual({ thinking: { type: 'enabled', effort: 'high' } });
    // GPT and Grok read the other field.
    expect(effortPayload('grok-4.7', 'high')).toEqual({ reasoning_effort: 'high' });
  });

  it('never sends a level the model does not accept, nor disables a model that refuses it', async () => {
    // deepseek-v4.1-flash accepts low/high/max only.
    expect(effortPayload('deepseek-v4.1-flash', 'medium')).toBeNull();
    // glm-5.3 is thinking-only: "disabled" is not offered and not sent.
    expect(opencodeGoCanDisableThinking('glm-5.3')).toBe(false);
    expect(effortPayload('glm-5.3', 'disabled')).toBeNull();
    // A model with no levels keeps its own default.
    expect(opencodeGoEfforts('mimo-v2.6-pro')).toEqual([]);
    expect(effortPayload('mimo-v2.6-pro', 'high')).toBeNull();
  });

  it('keeps the agent-friendly default when the level is automatic', async () => {
    // 'auto' and 'model' send nothing, so the fetch below injects `thinking: disabled` as before.
    expect(effortPayload('deepseek-v4.1-flash', 'auto')).toBeNull();
    expect(effortPayload('deepseek-v4.1-flash', 'model')).toBeNull();
    expect(shouldDisableThinking('deepseek-v4.1-flash', 'disabled')).toBe(true);
    // Asking for a named level turns reasoning ON, so the "disabled" injection is skipped.
    expect(shouldDisableThinking('deepseek-v4.1-flash', 'high')).toBe(false);
    // 'auto' keeps the injection the agent loop depends on.
    expect(shouldDisableThinking('deepseek-v4.1-flash', 'auto')).toBe(true);
  });
