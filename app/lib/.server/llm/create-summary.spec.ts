import { generateText } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { SUMMARY_MAX_OUTPUT_TOKENS, SUMMARY_TIMEOUT_MS, createSummary } from './create-summary';

/*
 * Pin the provider the test relies on, BEFORE the modules are imported. The defaults are read at
 * import time (app/utils/constants.ts), so setting them in beforeAll is too late. Without this the
 * default comes from the build environment: production sets OpenCodeGo, a bare test run falls back
 * to another provider, and the test fails with "Missing API key for OpenRouter" for a reason
 * unrelated to what it checks.
 */
vi.hoisted(() => {
  process.env.VITE_DEFAULT_PROVIDER = 'OpenCodeGo';
  process.env.VITE_DEFAULT_MODEL = 'deepseek-v4.1-flash';
});

/*
 * The summary is an EXTRA model call made before the real answer. It used to run with no
 * abort, no deadline and no output cap: a closed tab kept it running, and a stalled
 * provider held the turn before anything else could start.
 */

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();

  return { ...actual, generateText: vi.fn(async () => ({ text: 'SUMMARY', usage: { totalTokens: 1 } })) };
});

describe('createSummary', () => {
  /*
   * Pin the provider the test relies on. Without this the default comes from the build
   * environment (VITE_DEFAULT_PROVIDER): in production it is OpenCodeGo, but a bare test run
   * falls back to a different provider, and the test then fails with "Missing API key for
   * OpenRouter" for a reason unrelated to what it checks.
   */
  beforeAll(() => {
    vi.stubEnv('VITE_DEFAULT_PROVIDER', 'OpenCodeGo');
    vi.stubEnv('VITE_DEFAULT_MODEL', 'deepseek-v4.1-flash');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('bounds the summary call with the abort signal, a deadline and an output cap', async () => {
    const request = new AbortController();

    await createSummary({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] as never,
      apiKeys: { OpenCodeGo: 'test-key' },
      abortSignal: request.signal,
    });

    const options = vi.mocked(generateText).mock.calls[0]?.[0] as Record<string, unknown>;

    // Before: none of the three were passed — unbounded in time, lifetime and tokens.
    expect(options.abortSignal).toBe(request.signal);
    expect(options.timeout).toBe(SUMMARY_TIMEOUT_MS);
    expect(options.maxOutputTokens).toBe(SUMMARY_MAX_OUTPUT_TOKENS);
    expect(SUMMARY_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(SUMMARY_MAX_OUTPUT_TOKENS).toBeLessThan(8_192);
  }, 30_000);
});
