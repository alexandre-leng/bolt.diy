// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePromptEnhancer } from './usePromptEnhancer';
import { toast } from '~/lib/toastify';

vi.mock('~/lib/toastify', () => ({ toast: { error: vi.fn() } }));

/* LK audit: the enhancer must never replace the user's prompt with an error, nor stay spinning. */
const provider = { name: 'OpenAI' } as any;

afterEach(() => vi.unstubAllGlobals());

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('LK usePromptEnhancer', () => {
  it('keeps the original prompt when the server answers an error (401/429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: true, message: 'Missing API key for OpenAI' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const setInput = vi.fn();
    const { result } = renderHook(() => usePromptEnhancer());

    await act(async () => {
      await result.current.enhancePrompt('build me a todo app', setInput, 'gpt-x', provider);
    });
    await flush();

    expect(setInput).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Impossible d’améliorer le prompt : Missing API key for OpenAI');
  });

  it('restores the original prompt when the stream fails midway', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('partial '));
        c.error(new Error('network reset'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    const setInput = vi.fn();
    const { result } = renderHook(() => usePromptEnhancer());

    await act(async () => {
      await result.current.enhancePrompt('build me a todo app', setInput, 'gpt-x', provider);
    });
    await flush();

    expect(setInput.mock.calls.at(-1)?.[0]).toBe('build me a todo app');
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Impossible d’améliorer le prompt :'));
  });

  it('stops the spinner when fetch rejects (offline)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const setInput = vi.fn();
    const { result } = renderHook(() => usePromptEnhancer());

    await act(async () => {
      await result.current.enhancePrompt('build me a todo app', setInput, 'gpt-x', provider).catch(() => undefined);
    });
    await flush();

    expect(result.current.enhancingPrompt).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'Impossible d’améliorer le prompt : La connexion a échoué. Vérifiez votre connexion et réessayez.',
    );
  });
});
