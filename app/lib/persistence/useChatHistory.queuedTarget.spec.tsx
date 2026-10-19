import { act, renderHook, waitFor } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: a queued chat save must write to the chat it was requested for.
 *
 * The queue serialises saves. A save requested for chat A can therefore start its body
 * only after a previous save finishes — and by then the user may have opened chat B.
 * The old code read `chatId.get()` inside the queued body (and again after several
 * awaits), so it wrote chat A's messages under chat B's id, erasing the conversation the
 * user just opened, on every device.
 */

const { resetWorkbench, waitForExecutionQueue, setMessages, setSnapshot } = vi.hoisted(() => ({
  resetWorkbench: vi.fn(async (): Promise<void> => undefined),
  waitForExecutionQueue: vi.fn(async () => undefined),
  setMessages: vi.fn(async () => undefined),
  setSnapshot: vi.fn(async () => undefined),
}));

vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    resetWorkbench,
    waitForExecutionQueue,
    files: { get: () => ({}) },
    firstArtifact: undefined,
    fileEditRevision: { listen: () => () => undefined },
  },
}));

vi.mock('~/lib/webcontainer', () => ({
  webcontainer: new Promise(() => undefined),
  webcontainerContext: { loaded: false },
}));

vi.mock('./db', () => ({
  openDatabase: vi.fn(async () => ({})),
  createChatWithNextId: vi.fn(async () => ({ id: '3' })),
  setMessages,
  setSnapshot,
  duplicateChat: vi.fn(async () => 'dupe'),
  createChatFromMessages: vi.fn(async () => 'imported'),
  getMessagesByIdRaw: vi.fn(async () => undefined),
  getMessagesByUrlIdRaw: vi.fn(async () => undefined),
  getUrlId: vi.fn(async (_db: unknown, id: string) => id),
}));

const records: Record<string, { id: string; urlId: string }> = {
  'chat-a': { id: '1', urlId: 'chat-a' },
  'chat-b': { id: '2', urlId: 'chat-b' },
};

vi.mock('./chatCache', () => ({
  getCachedMessages: vi.fn(async (_db: unknown, routeId: string) => {
    const record = records[routeId];

    return {
      id: record?.id ?? routeId,
      urlId: record?.urlId ?? routeId,
      description: routeId,
      messages: [
        { id: `${routeId}-user`, role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        { id: `${routeId}-assistant`, role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
      ] as UIMessage[],
    };
  }),
  getCachedSnapshot: vi.fn(async () => undefined),
  invalidateChatCache: vi.fn(),
}));

let routeId: string | undefined = 'chat-a';
let routeSearch = '';

const searchParamsCache = new Map<string, URLSearchParams>();
const navigate = vi.fn();
const setSearchParams = vi.fn();

vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useLoaderData: () => undefined,
  useParams: () => ({ id: routeId }),
  useSearchParams: () => {
    let params = searchParamsCache.get(routeSearch);

    if (!params) {
      params = new URLSearchParams(routeSearch);
      searchParamsCache.set(routeSearch, params);
    }

    return [params, setSearchParams];
  },
}));

describe('useChatHistory queued save targets', () => {
  beforeEach(() => {
    resetWorkbench.mockClear();
    waitForExecutionQueue.mockClear();
    setMessages.mockClear();
    setSnapshot.mockClear();
    routeId = 'chat-a';
    routeSearch = '';
    searchParamsCache.clear();
    window.history.replaceState(window.history.state, '', '/');

    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: Record<string, unknown> = {};

        queueMicrotask(() => {
          request.result = {};
          (request.onsuccess as (event: unknown) => void)?.({ target: request });
        });

        return request;
      },
    });
  });

  it('writes a queued save to its own chat, not the one opened while it waited', async () => {
    const { useChatHistory, chatId } = await import('./useChatHistory');
    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.ready).toBe(true));

    // Chat 1 is the one on screen.
    expect(chatId.get()).toBe('1');

    // The first save hangs inside setMessages, so the second one is queued behind it.
    let releaseFirst!: (value: undefined) => void;

    setMessages.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseFirst = resolve;
        }),
    );

    let firstSave!: Promise<void>;

    await act(async () => {
      firstSave = result.current.storeMessageHistory([
        { id: 'a-1', role: 'assistant', content: 'on a', parts: [{ type: 'text', text: 'on a' }] },
      ] as any) as unknown as Promise<void>;
    });

    // The pending save is blocked on the first setMessages call, for chat 1.
    await waitFor(() => expect((setMessages.mock.calls as unknown[][]).some((call) => call[1] === '1')).toBe(true));

    /*
     * A second save is queued while the first is still in flight. Its closure captures
     * the target chat id at request time, before it is blocked on the queue.
     */
    let secondSave!: Promise<void>;

    await act(async () => {
      secondSave = result.current.storeMessageHistory([
        { id: 'a-1', role: 'assistant', content: 'on a', parts: [{ type: 'text', text: 'on a' }] },
        { id: 'a-2', role: 'assistant', content: 'still on a', parts: [{ type: 'text', text: 'still on a' }] },
      ] as any) as unknown as Promise<void>;
    });

    /*
     * The user opens another chat. On the real app this happens when the route changes and
     * the loader calls chatId.set(newId); here it is applied directly, so the assertion is
     * about the queued save's target, not about routing.
     */
    chatId.set('2');

    // Now let the queue drain.
    setMessages.mockClear();
    await act(async () => {
      releaseFirst(undefined);
      await Promise.allSettled([firstSave, secondSave]);
    });

    // Every write that happened must target chat 1 — never chat 2.
    const writtenChatIds = (setMessages.mock.calls as unknown[][]).map((call) => call[1]);
    expect(writtenChatIds.length).toBeGreaterThan(0);
    expect(writtenChatIds).not.toContain('2');
    expect(writtenChatIds.every((id) => id === '1')).toBe(true);
  });
});
