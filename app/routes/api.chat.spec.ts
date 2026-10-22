import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { action as chatAction } from './api.chat';
import { __resetKeyCacheForTests } from '~/lib/.server/api/instance-keys';
import { streamText } from '~/lib/.server/llm/stream-text';
import { MCPService } from '~/lib/services/mcpService';

/*
 * The build turn end to end, with a mocked gateway: MCP name collisions, a failing chat
 * summary, the first-chunk deadline and the continuation ordering are all properties of
 * ONE request, so they are proven here rather than on extracted helpers.
 */

vi.mock('~/lib/.server/llm/stream-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/.server/llm/stream-text')>();

  return {
    ...actual,
    streamText: vi.fn((...args: Parameters<typeof actual.streamText>) => actual.streamText(...args)),
  };
});

type ChatCompletion = { content: string; finishReason: string };

function completionsResponse(chunks: ChatCompletion[]) {
  const events =
    chunks
      .map((chunk) =>
        chunk.content
          ? `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: chunk.content } }] })}\n\n`
          : '',
      )
      .join('') +
    `data: ${JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: chunks[chunks.length - 1].finishReason }],
    })}\n\n` +
    'data: [DONE]\n\n';

  return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
}

function chatRequest(body: unknown) {
  return new Request('https://bolt.example/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  messages: [
    {
      id: '1-1792165586520-0',
      role: 'user',
      parts: [{ type: 'text', text: '[Model: deepseek-v4.1-flash]\n\n[Provider: OpenCodeGo]\n\nbuild the app' }],
    },
  ],
  chatMode: 'build',
  agentMode: false,
  contextOptimization: true,
  files: { '/home/project/src/App.tsx': { type: 'file', content: 'app', isBinary: false } },
};

/** No files and no context optimisation: isolates the streaming/turn behaviour under test. */
const streamOnlyBody = {
  messages: baseBody.messages,
  chatMode: 'build',
  agentMode: false,
};

function invoke(body: unknown = baseBody) {
  return chatAction({
    request: chatRequest(body),
    context: { clientAddress: '127.0.0.1' },
    params: {},
  } as never);
}

/*
 * The key resolver reads the accounts service and fails closed when it cannot read the policy, so
 * this file answers that one lookup for the whole run. A per-test stub cannot do it: the
 * `vi.unstubAllGlobals()` of afterEach restores the real `fetch`, and the next case would answer
 * 503 for a policy it simply could not read.
 */
const passthrough = globalThis.fetch;

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/internal/effective-keys')) {
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

    return passthrough ? passthrough(input, init) : Response.json({});
  }),
);

/**
 * Answer the gateway calls a case makes, while still serving the accounts lookup.
 *
 * `vi.stubGlobal('fetch', …)` would also swallow `/internal/effective-keys`, and the resolver then
 * refuses the whole turn with 503 before the code under test runs.
 */
function stubGateway(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/internal/effective-keys') ? effectiveKeysResponse() : handler(input, init),
    ),
  );
}

function effectiveKeysResponse() {
  return Promise.resolve(
    Response.json({
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
    }),
  );
}

describe('POST /api/chat', () => {
  /*
   * The key resolver is cached per account and fails closed when it cannot read the policy, so
   * each case starts from a cleared cache AND a stub that answers the accounts lookup: without
   * the stub the resolver keeps the first case's failure and every later turn answers 503.
   */
  beforeEach(() => {
    __resetKeyCacheForTests();
    vi.stubEnv('OPENCODE_GO_API_KEY', 'test-key');
    vi.spyOn(MCPService.getInstance(), 'checkServersAvailabilities').mockResolvedValue({});
  });

  afterEach(() => {
    __resetKeyCacheForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(streamText).mockClear();
  });

  it('keeps the turn alive when an MCP server exposes a built-in tool name', async () => {
    // `web_search` is a built-in project tool: the collision used to throw and fail every build turn.
    vi.spyOn(MCPService.getInstance(), 'getToolsWithoutExecute').mockReturnValue({
      web_search: { description: 'MCP search', inputSchema: { type: 'object' } },
    } as never);

    stubGateway(async () => completionsResponse([{ content: 'hello', finishReason: 'stop' }]));

    const response = await invoke(streamOnlyBody);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('hello');
    expect(body).not.toMatch(/Built-in MCP tool name conflict/);
  }, 30_000);

  it('continues without the chat summary when the summary call fails', async () => {
    stubGateway(async (_input: RequestInfo | URL, init?: RequestInit) => {
      // generateText (summary) vs streamText (chat) both hit /chat/completions.
      if (!String(init?.body ?? '').includes('"stream":true')) {
        return new Response(JSON.stringify({ error: { message: 'summary provider down' } }), { status: 400 });
      }

      return completionsResponse([{ content: 'hello', finishReason: 'stop' }]);
    });

    const response = await invoke();
    const body = await response.text();

    // Before: the summary failure propagated and the turn ended with an error chunk.
    expect(response.status).toBe(200);
    expect(body).toContain('Analysis skipped');
    expect(body).toContain('hello');
    expect(body).not.toContain('"type":"error"');
  }, 30_000);

  it('sets a first-chunk deadline on the non-agent path (a hung provider must not hang the turn)', async () => {
    stubGateway(async () => completionsResponse([{ content: 'x', finishReason: 'stop' }]));

    const response = await invoke(streamOnlyBody);

    // The route's execute runs when the body is consumed, not when the response is built.
    await response.text();

    const firstCall = vi.mocked(streamText).mock.calls[0]?.[0] as {
      options?: { timeout?: Record<string, number> };
    };

    /*
     * Before: only chunkMs, which starts AFTER the first chunk — a provider that never
     * answered left the request pending forever.
     */
    expect(firstCall.options?.timeout?.firstChunkMs).toBe(120_000);
  }, 30_000);

  it('ends with a truncation notice when the segment cap is reached instead of throwing', async () => {
    const fetchMock = vi.fn(async () => completionsResponse([{ content: 'more ', finishReason: 'length' }]));
    stubGateway(fetchMock);

    const response = await invoke(streamOnlyBody);
    const body = await response.text();

    // Before: `throw` inside onEnd surfaced as a stream error, not as a message.
    expect(response.status).toBe(200);
    expect(body).toContain('Response truncated: maximum length reached');
    expect(body).not.toContain('"type":"error"');

    // initial segment + one continuation; the third request never happens.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('sends `finish` only after the continuation text, in a single finished message', async () => {
    let chatCalls = 0;

    stubGateway(async () => {
      chatCalls += 1;

      return chatCalls === 1
        ? completionsResponse([{ content: 'part1 ', finishReason: 'length' }])
        : completionsResponse([{ content: 'part2', finishReason: 'stop' }]);
    });

    const response = await invoke(streamOnlyBody);
    const body = await response.text();

    const events = body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6).trim())
      .filter((data) => data && data !== '[DONE]')
      .map((data) => JSON.parse(data) as { type: string; delta?: string });

    const textOf = (event: { type: string; delta?: string }) => (event.type === 'text-delta' ? event.delta : '') ?? '';
    const joined = events.map(textOf).join('');
    const finishIndex = events.findIndex((event) => event.type === 'finish');

    expect(response.status).toBe(200);
    expect(joined).toContain('part1');
    expect(joined).toContain('part2');

    // Before: the first segment's `finish` reached the client before the continuation text.
    expect(finishIndex).toBeGreaterThan(events.findIndex((event) => textOf(event).includes('part2')));
    expect(events.filter((event) => event.type === 'finish')).toHaveLength(1);
  }, 30_000);
});
