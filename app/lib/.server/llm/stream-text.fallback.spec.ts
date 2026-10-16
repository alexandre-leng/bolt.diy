import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamText } from './stream-text';
import { LLMManager } from '~/lib/modules/llm/manager';

describe('streamText with a model the provider does not know', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports the swap instead of answering silently with another model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('no network in tests');
      }),
    );

    // No network: the provider's dynamic list is empty, only its static models remain.
    vi.spyOn(LLMManager.getInstance(), 'getModelListFromProvider').mockResolvedValue([]);

    const onModelFallback = vi.fn();

    await streamText({
      messages: [
        {
          id: 'u1',
          role: 'user',
          parts: [{ type: 'text', text: '[Model: ghost-model]\n\n[Provider: OpenCodeGo]\n\nhello' }],
        },
      ] as never,
      env: {} as Env,
      apiKeys: { OpenCodeGo: 'test-key' },
      chatMode: 'discuss',
      onModelFallback,
    }).catch(() => undefined);

    expect(onModelFallback).toHaveBeenCalledTimes(1);
    expect(onModelFallback.mock.calls[0][0]).toMatchObject({ requested: 'ghost-model', provider: 'OpenCodeGo' });
    expect(onModelFallback.mock.calls[0][0].used).not.toBe('ghost-model');
  });

  it('does not send the [Model:]/[Provider:] routing markers to the model', async () => {
    const bodies: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''));
        throw new Error('captured');
      }),
    );

    const marker = (text: string) => `[Model: deepseek-v4.1-flash]\n\n[Provider: OpenCodeGo]\n\n${text}`;

    const result = await streamText({
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: marker('first question') }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'an answer' }] },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: marker('second question') }] },
      ] as never,
      env: {} as Env,
      apiKeys: { OpenCodeGo: 'test-key' },
      chatMode: 'discuss',
      options: { maxRetries: 0 } as never,
    });

    await Promise.resolve(result.consumeStream()).catch(() => undefined);

    const sent = bodies.join('\n');
    expect(sent).toContain('first question');
    expect(sent).toContain('second question');
    expect(sent).not.toContain('[Model:');
    expect(sent).not.toContain('[Provider:');
  });
});
