import { afterEach, describe, expect, it, vi } from 'vitest';
import { action as transcribeAction } from './api.transcribe';

/*
 * `/api/transcribe` is the engine that gives Firefox, Safari and Brave a working microphone.
 * What is proven here:
 * - a binary body survives the body reader (a UTF-8 decode of WebM corrupts it);
 * - OpenAI is tried before Groq, and a refused key falls through to the next provider;
 * - no provider message, and no key, ever reaches the client;
 * - an unconfigured deployment says "key missing" instead of failing opaquely.
 */

const openaiKey = 'sk-test-openai-key-0000000000000000000000000000';
const groqKey = 'gsk_test_groq_key_0000000000000000000000000000';

/** A minimal WebM-ish payload: bytes above 0x7f that a UTF-8 round trip would replace. */
const audioBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xfe, 0x00, 0x80, 0x9f]);

function makeRequest(form: FormData) {
  return new Request('https://example.com/api/transcribe', { method: 'POST', body: form });
}

function makeForm(options: { name?: string; type?: string; language?: string } = {}) {
  const form = new FormData();
  form.append('file', new File([audioBytes], options.name ?? 'dictation.webm', { type: options.type ?? 'audio/webm' }));
  form.append('language', options.language ?? 'fr-FR');

  return form;
}

function invoke(request: Request, env: Record<string, unknown>, clientAddress = '10.1.2.3') {
  return transcribeAction({
    request,

    // The same shape the Worker passes: `clientAddress` is what the rate limiter keys on.
    context: { clientAddress, cloudflare: { env } },
    params: {},
  } as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/transcribe', () => {
  it('forwards the bytes unchanged and answers the provider text', async () => {
    const seen: { url: string; file?: File; language?: string; model?: string }[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const form = init.body as FormData;
        const file = form.get('file') as File;

        seen.push({
          url: String(url),
          file,
          language: String(form.get('language')),
          model: String(form.get('model')),
        });

        return Response.json({ text: '  Bonjour le monde  ' });
      }),
    );

    const response = await invoke(makeRequest(makeForm()), { OPENAI_API_KEY: openaiKey });
    const body = (await response.json()) as { text: string };

    expect(response.status).toBe(200);
    expect(body.text).toBe('Bonjour le monde');

    expect(seen[0].url).toContain('api.openai.com');
    expect(seen[0].model).toBe('whisper-1');

    // Base language only: Whisper rejects `fr-FR`.
    expect(seen[0].language).toBe('fr');

    // The clip must arrive byte-identical: a UTF-8 decode would replace 0xdf/0xff/0x9f.
    const received = new Uint8Array(await seen[0].file!.arrayBuffer());
    expect(Array.from(received)).toEqual(Array.from(audioBytes));
    expect(seen[0].file!.name).toBe('dictation.webm');
  });

  it('falls back to Groq when OpenAI refuses the key', async () => {
    const urls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));

        if (String(url).includes('openai.com')) {
          return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-...' } }), {
            status: 401,
          });
        }

        return Response.json({ text: 'transcrit par groq' });
      }),
    );

    const response = await invoke(makeRequest(makeForm()), {
      OPENAI_API_KEY: openaiKey,
      GROQ_API_KEY: groqKey,
    });

    expect(urls.some((url) => url.includes('openai.com'))).toBe(true);
    expect(urls.some((url) => url.includes('api.groq.com'))).toBe(true);

    const body = (await response.json()) as { text: string };
    expect(response.status).toBe(200);
    expect(body.text).toBe('transcrit par groq');
  });

  it('never echoes a provider message or a key to the client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${openaiKey}` } }), {
            status: 401,
          }),
      ),
    );

    const response = await invoke(makeRequest(makeForm()), { OPENAI_API_KEY: openaiKey });
    const raw = await response.text();

    expect(raw).not.toContain(openaiKey);
    expect(raw).not.toContain('Incorrect API key');
    expect(response.status).toBe(503);
    expect(JSON.parse(raw).code).toBe('key-missing');
  });

  it('answers key-missing, not a 500, when no provider is configured', async () => {
    const response = await invoke(makeRequest(makeForm()), {});

    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe('key-missing');
  });

  it('refuses a request with no audio', async () => {
    const form = new FormData();
    form.append('language', 'fr-FR');

    const response = await invoke(makeRequest(form), { OPENAI_API_KEY: openaiKey });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('provider-refused');
  });

  it('refuses an oversized clip before any provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const big = new Uint8Array(13 * 1024 * 1024);
    const form = new FormData();
    form.append('file', new File([big], 'huge.webm', { type: 'audio/webm' }));

    const response = await invoke(makeRequest(form), { OPENAI_API_KEY: openaiKey });

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts an unlabelled recording: the container is what matters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ text: 'ok' })),
    );

    const response = await invoke(makeRequest(makeForm({ type: 'application/octet-stream' })), {
      OPENAI_API_KEY: openaiKey,
    });

    expect(response.status).toBe(200);
  });
});
