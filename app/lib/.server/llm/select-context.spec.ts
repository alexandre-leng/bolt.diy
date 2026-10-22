import { generateText } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { SELECT_CONTEXT_MAX_OUTPUT_TOKENS, SELECT_CONTEXT_TIMEOUT_MS, selectContext } from './select-context';

vi.hoisted(() => {
  process.env.VITE_DEFAULT_PROVIDER = 'OpenCodeGo';
  process.env.VITE_DEFAULT_MODEL = 'deepseek-v4.1-flash';
});

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(async () => ({
      text: '<updateContextBuffer></updateContextBuffer>',
      usage: { totalTokens: 1 },
    })),
  };
});

describe('selectContext cancellation and bounds', () => {
  it('passes request cancellation, timeout and token cap to generateText', async () => {
    const controller = new AbortController();
    await selectContext({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] as never,
      files: {},
      summary: '',
      apiKeys: { OpenCodeGo: 'test-key' },
      abortSignal: controller.signal,
    });

    const options = vi.mocked(generateText).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.abortSignal).toBe(controller.signal);
    expect(options.timeout).toBe(SELECT_CONTEXT_TIMEOUT_MS);
    expect(options.maxOutputTokens).toBe(SELECT_CONTEXT_MAX_OUTPUT_TOKENS);
  });
});
