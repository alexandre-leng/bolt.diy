import { act, renderHook, waitFor } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Lot 3 — restore and save defects of useChatHistory (plan items P1, P2, P3, P5, P10-P14,
 * P16). Unlike useChatHistory.spec.tsx, the database here is an in-memory store that keeps
 * what the hook writes, enforces the unique `urlId` index like IndexedDB, and serves the
 * reads back, so a save followed by a reload is observable.
 */
type StoredChat = {
  id: string;
  urlId?: string;
  description?: string;
  timestamp: string;
  messages: UIMessage[];
  metadata?: unknown;
};

const h = vi.hoisted(() => ({
  chats: new Map<string, any>(),
  snapshots: new Map<string, any>(),
  nextId: 100,
  files: {} as Record<string, unknown>,
  firstArtifact: undefined as undefined | { id: string; title: string },
  writeFile: (() => undefined) as (...args: unknown[]) => unknown,
}));

const byUrlId = (urlId: string) => [...h.chats.values()].find((chat) => chat.urlId === urlId);

function freeUrlId(wanted: string): string {
  let candidate = wanted;
  let suffix = 2;

  while (byUrlId(candidate)) {
    candidate = `${wanted}-${suffix++}`;
  }

  return candidate;
}

const writeFile = vi.fn(async () => undefined);
h.writeFile = writeFile;

const fileEditRevision = vi.hoisted(() => ({ atom: undefined as any }));

vi.mock('~/lib/stores/workbench', async () => {
  const { atom: makeAtom } = await import('nanostores');
  fileEditRevision.atom = makeAtom(0);

  return {
    workbenchStore: {
      resetWorkbench: vi.fn(async () => undefined),
      waitForExecutionQueue: vi.fn(async () => undefined),
      showPreviewAfterRestore: vi.fn(),
      files: { get: () => h.files, setKey: vi.fn() },
      get firstArtifact() {
        return h.firstArtifact;
      },
      get fileEditRevision() {
        return fileEditRevision.atom;
      },
    },
  };
});

vi.mock('~/lib/webcontainer', () => ({
  webcontainer: Promise.resolve({
    workdir: '/home/project',
    fs: { mkdir: vi.fn(async () => undefined), writeFile: (...args: unknown[]) => h.writeFile(...args) },
  }),
  webcontainerContext: { loaded: true },
}));

vi.mock('~/lib/toastify', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('./db', () => ({
  openDatabase: vi.fn(async () => ({})),
  setMessages: vi.fn(
    async (
      _db: unknown,
      id: string,
      messages: UIMessage[],
      urlId?: string,
      description?: string,
      timestamp?: string,
      metadata?: unknown,
    ) => {
      const holder = urlId ? byUrlId(urlId) : undefined;

      if (holder && holder.id !== id) {
        throw Object.assign(new Error('Unable to add key to index urlId'), { name: 'ConstraintError' });
      }

      h.chats.set(id, { id, messages, urlId, description, timestamp: timestamp ?? new Date().toISOString(), metadata });
    },
  ),
  createChatWithNextId: vi.fn(
    async (
      _db: unknown,
      messages: UIMessage[],
      urlId?: string,
      description?: string,
      metadata?: unknown,
      ensureUrlId = false,
    ) => {
      const id = String(h.nextId++);
      const finalUrlId = ensureUrlId ? freeUrlId(urlId || id) : urlId;
      h.chats.set(id, { id, messages, urlId: finalUrlId, description, timestamp: new Date().toISOString(), metadata });

      return { id, urlId: finalUrlId };
    },
  ),
  getUrlId: vi.fn(async (_db: unknown, wanted: string) => freeUrlId(wanted)),
  getMessagesByIdRaw: vi.fn(async (_db: unknown, id: string) => h.chats.get(id)),
  getMessagesByUrlIdRaw: vi.fn(async (_db: unknown, id: string) => byUrlId(id)),
  setSnapshot: vi.fn(async (_db: unknown, chatId: string, snapshot: unknown) => {
    h.snapshots.set(chatId, snapshot);
  }),
  duplicateChat: vi.fn(),
  createChatFromMessages: vi.fn(),
}));

vi.mock('./chatCache', () => ({
  getCachedMessages: vi.fn(async (_db: unknown, id: string) => {
    const chat = h.chats.get(id) ?? byUrlId(id);

    return chat ? structuredClone(chat) : undefined;
  }),
  getCachedSnapshot: vi.fn(async (_db: unknown, id: string) => h.snapshots.get(id)),
  invalidateChatCache: vi.fn(),
}));

vi.mock('./historySync', () => ({
  pushChat: vi.fn(async () => true),
  reconcileChat: vi.fn(async () => undefined),
}));

let routeId: string | undefined;
let routeSearch = '';

const searchParamsCache = new Map<string, URLSearchParams>();

const navigate = vi.fn((to: string, options?: { replace?: boolean }) => {
  if (options?.replace) {
    window.history.replaceState(window.history.state, '', to);
  }
});

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

    return [params, vi.fn()];
  },
}));

const { setMessages, setSnapshot } = await import('./db');
const { pushChat, reconcileChat } = await import('./historySync');
const { toast } = await import('~/lib/toastify');

async function loadHook() {
  const module = await import('./useChatHistory');

  return module;
}

const text = (id: string, role: 'user' | 'assistant', body: string) =>
  ({ id, role, parts: [{ type: 'text', text: body }] }) as UIMessage;

const textOf = (message: UIMessage) =>
  (message.parts as { type: string; text?: string }[])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');

function seed(chat: Partial<StoredChat> & { id: string; messages: UIMessage[] }) {
  h.chats.set(chat.id, { timestamp: '2026-01-01T00:00:00.000Z', ...chat });
}

describe('useChatHistory — lot 3 regressions', () => {
  beforeEach(async () => {
    h.chats.clear();
    h.snapshots.clear();
    h.files = {};
    h.firstArtifact = undefined;
    vi.clearAllMocks();
    vi.mocked(reconcileChat).mockResolvedValue(undefined);
    routeId = undefined;
    routeSearch = '';
    searchParamsCache.clear();
    window.history.replaceState(null, '', '/');

    const module = await loadHook();
    module.chatId.set(undefined);
    module.description.set(undefined);
  });

  /*
   * P1. Opening /chat/<urlId> on a device that does not hold the chat read IndexedDB only
   * and bounced to the home page; the server was never asked.
   */
  it('P1: loads a chat absent locally from the server instead of redirecting home', async () => {
    const { useChatHistory } = await loadHook();
    vi.mocked(reconcileChat).mockResolvedValue({
      id: '5',
      urlId: 'shared-link',
      description: 'Shared',
      timestamp: '2026-01-01T00:00:00.000Z',
      messages: [text('u1', 'user', 'hi'), text('a1', 'assistant', 'hello')],
    } as never);

    routeId = 'shared-link';

    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(reconcileChat).toHaveBeenCalledWith({}, 'shared-link');
    expect(navigate).not.toHaveBeenCalledWith('/', expect.anything());
    expect(result.current.initialMessages.map((message) => message.id)).toEqual(['u1', 'a1']);
  });

  it('P1: still goes home when neither the device nor the server has the chat', async () => {
    const { useChatHistory } = await loadHook();
    routeId = 'nowhere';

    renderHook(() => useChatHistory());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  /*
   * P2. The mid-turn snapshot of a chat's FIRST turn is anchored on message 0; the restore
   * only accepted `startingIdx > 0`, so the project built during that turn came back empty
   * and the first prompt silently disappeared.
   */
  it('P2: restores a snapshot anchored on the first message', async () => {
    const { useChatHistory } = await loadHook();
    seed({
      id: '1',
      urlId: 'first-turn',
      messages: [
        text('u1', 'user', 'build a site'),
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-project_write_file',
              toolCallId: 't1',
              state: 'output-available',
              input: { path: 'src/App.tsx', content: 'export const App = 1;\n' },
              output: { path: 'src/App.tsx', written: true },
            },
          ],
        } as unknown as UIMessage,
      ],
    });
    h.snapshots.set('1', {
      chatIndex: 'u1',
      files: { '/home/project/index.html': { type: 'file', content: '<p>built</p>', isBinary: false } },
    });

    routeId = 'first-turn';

    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(writeFile).toHaveBeenCalledWith('index.html', '<p>built</p>', { encoding: 'utf8' });

    const texts = result.current.initialMessages.map(textOf).join('\n');
    expect(texts).toContain('Restored your chat from a snapshot');
    expect(texts).toContain('restored-agent-files');
  });

  /*
   * P3. An unknown rewind target emptied the conversation, and the next save wrote that
   * empty history over the stored one.
   */
  it('P3: ignores an unknown rewindTo instead of emptying the conversation', async () => {
    const { useChatHistory } = await loadHook();
    seed({
      id: '1',
      urlId: 'four',
      messages: [
        text('m1', 'user', 'a'),
        text('m2', 'assistant', 'b'),
        text('m3', 'user', 'c'),
        text('m4', 'assistant', 'd'),
      ],
    });

    routeId = 'four';
    routeSearch = 'rewindTo=restored-replay-id';
    window.history.replaceState(null, '', '/chat/four?rewindTo=restored-replay-id');

    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.initialMessages.map((message) => message.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(toast.warning).toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  /*
   * P3. `rewindTo` stayed in the URL: every reload truncated the conversation again, hiding
   * the turns made after the rewind (and the next save then erased them).
   */
  it('P3: drops rewindTo once the rewound history is saved, and never re-applies it', async () => {
    const { useChatHistory } = await loadHook();
    seed({
      id: '1',
      urlId: 'four',
      messages: [
        text('m1', 'user', 'a'),
        text('m2', 'assistant', 'b'),
        text('m3', 'user', 'c'),
        text('m4', 'assistant', 'd'),
      ],
    });

    routeId = 'four';
    routeSearch = 'rewindTo=m2';
    window.history.replaceState(null, '', '/chat/four?rewindTo=m2');

    const { result, rerender } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.initialMessages.map((message) => message.id)).toEqual(['m1', 'm2']);

    await act(async () => {
      await result.current.storeMessageHistory([
        text('m1', 'user', 'a'),
        text('m2', 'assistant', 'b'),
        text('m5', 'user', 'new'),
      ]);
    });

    expect(h.chats.get('1').messages.map((message: UIMessage) => message.id)).toEqual(['m1', 'm2', 'm5']);
    expect(window.location.search).toBe('');

    /*
     * The router still believes the old query: a re-run must not truncate again. (The save
     * took an end-of-turn snapshot on m5, so the reload shows the restore message for m5.)
     */
    routeSearch = 'rewindTo=m2&view=preview';
    rerender();

    await waitFor(() => expect(result.current.initialMessages.at(-1)?.id).toBe('m5'));
  });

  /*
   * P5. A chat created before its first artifact took the artifact's id as urlId on a later
   * save without deduplication: another chat holding it made every later save fail.
   */
  it('P5: deduplicates the urlId an existing chat takes from its first artifact', async () => {
    const { useChatHistory } = await loadHook();
    seed({ id: '1', urlId: 'todo-app', messages: [text('x', 'user', 'other')] });

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.storeMessageHistory([text('u1', 'user', 'make a todo app')], true);
    });

    const created = [...h.chats.keys()].find((id) => id !== '1')!;
    expect(h.chats.get(created).urlId).toBeUndefined();

    h.firstArtifact = { id: 'todo-app', title: 'Todo app' };

    await act(async () => {
      await result.current.storeMessageHistory(
        [text('u1', 'user', 'make a todo app'), text('a1', 'assistant', 'working')],
        true,
      );
    });

    expect(h.chats.get(created).urlId).toBe('todo-app-2');
    expect(h.chats.get(created).messages).toHaveLength(2);

    await act(async () => {
      await result.current.storeMessageHistory(
        [text('u1', 'user', 'make a todo app'), text('a1', 'assistant', 'done')],
        false,
      );
    });

    // Allocated once: the next save must not move it to -3.
    expect(h.chats.get(created).urlId).toBe('todo-app-2');
    expect(h.chats.get('1').urlId).toBe('todo-app');
  });

  /*
   * P10 + P11. Reopened without a snapshot: the template's artifact re-creates a file the
   * agent deleted, and its install ran on the template's package.json, not the agent's.
   */
  it('P10/P11: the replay deletes what the agent deleted, reinstalls, then restarts', async () => {
    const { useChatHistory } = await loadHook();
    seed({
      id: '1',
      urlId: 'agent',
      messages: [
        text('u0', 'user', 'start'),
        text(
          'a0',
          'assistant',
          `<boltArtifact id="imported-files" title="T" type="bundled">
<boltAction type="file" filePath="package.json">{"scripts":{"dev":"vite"}}</boltAction>
<boltAction type="file" filePath="src/App.css">a {}</boltAction>
<boltAction type="shell">npm install</boltAction>
<boltAction type="start">npm run dev</boltAction>
</boltArtifact>`,
        ),
        text('u1', 'user', 'add a router'),
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-project_write_file',
              toolCallId: 'w1',
              state: 'output-available',
              input: {
                path: 'package.json',
                content: '{"scripts":{"dev":"vite"},"dependencies":{"react-router-dom":"7"}}',
              },
              output: { path: 'package.json', written: true },
            },
            {
              type: 'tool-project_delete_path',
              toolCallId: 'd1',
              state: 'output-available',
              input: { path: 'src/App.css' },
              output: { path: 'src/App.css', deleted: true },
            },
          ],
        } as unknown as UIMessage,
      ],
    });

    routeId = 'agent';

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    /*
     * The replayed message now also carries the narration of the turn, so the order to read is the
     * order of the ARTIFACT's actions, not the first occurrence of each string in the whole text.
     */
    const last = result.current.initialMessages.at(-1)!;
    const replay = textOf(last);
    const artifactStart = replay.indexOf('<boltArtifact');
    const actions = artifactStart === -1 ? replay : replay.slice(artifactStart);
    const remove = actions.indexOf('rm -rf "/home/project/src/App.css"');
    const install = actions.indexOf('npm install');

    expect(replay).toContain('restored-agent-files');
    expect(remove).toBeGreaterThan(-1);

    /*
     * Install and start are now ONE chained action (`npm install && npm run dev`): two separate
     * actions could be separated by anything the runner decided to do in between, and the server
     * then started on a tree whose dependencies were not there yet.
     */
    expect(install).toBeGreaterThan(remove);
    expect(actions.slice(install, install + 200)).toContain('&& npm run dev</boltAction>');
  });

  /*
   * P12. A manual save in the editor never reached a snapshot: reloading without sending a
   * message lost the edit.
   */
  it('P12: snapshots the project after a manual file edit', async () => {
    const { useChatHistory } = await loadHook();
    seed({ id: '1', urlId: 'edited', messages: [text('u1', 'user', 'a'), text('a1', 'assistant', 'b')] });

    routeId = 'edited';

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    h.files = { '/home/project/a.ts': { type: 'file', content: 'x', isBinary: false } };
    fileEditRevision.atom.set(fileEditRevision.atom.get() + 1);

    await waitFor(
      () =>
        expect(setSnapshot).toHaveBeenCalledWith(
          {},
          '1',
          expect.objectContaining({
            chatIndex: 'a1',
            files: { '/home/project/a.ts': { type: 'file', content: 'x', isBinary: false } },
          }),
        ),
      { timeout: 4000 },
    );
  });

  /*
   * P13. The chat was continued on another device and pulled into IndexedDB while this tab
   * kept the older messages: the next save erased the other device's turns.
   */
  it('P13: refuses to overwrite turns another device added since the chat was loaded', async () => {
    const { useChatHistory } = await loadHook();
    seed({
      id: '1',
      urlId: 'shared',
      timestamp: '2026-01-01T00:00:00.000Z',
      messages: [text('u1', 'user', 'a'), text('a1', 'assistant', 'b')],
    });

    routeId = 'shared';

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    // The sidebar sync pulls the phone's copy.
    seed({
      id: '1',
      urlId: 'shared',
      timestamp: '2026-01-02T00:00:00.000Z',
      messages: [
        text('u1', 'user', 'a'),
        text('a1', 'assistant', 'b'),
        text('u2', 'user', 'phone'),
        text('a2', 'assistant', 'p'),
      ],
    });

    await act(async () => {
      await result.current.storeMessageHistory([
        text('u1', 'user', 'a'),
        text('a1', 'assistant', 'b'),
        text('u3', 'user', 'desk'),
      ]);
    });

    expect(h.chats.get('1').messages.map((message: UIMessage) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(pushChat).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('P13: a rename (newer timestamp, same messages) is not a conflict', async () => {
    const { useChatHistory } = await loadHook();
    seed({ id: '1', urlId: 'renamed', messages: [text('u1', 'user', 'a'), text('a1', 'assistant', 'b')] });

    routeId = 'renamed';

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    h.chats.get('1').timestamp = '2026-01-05T00:00:00.000Z';
    h.chats.get('1').description = 'New name';

    await act(async () => {
      await result.current.storeMessageHistory([
        text('u1', 'user', 'a'),
        text('a1', 'assistant', 'b'),
        text('u2', 'user', 'c'),
      ]);
    });

    expect(h.chats.get('1').messages).toHaveLength(3);
  });

  /*
   * P14. A turn with no artifact (Agent mode) left the chat with neither urlId nor
   * description, and the sidebar lists neither kind.
   */
  it('P14: gives an artifact-less chat a urlId and a description at the end of its turn', async () => {
    const { useChatHistory } = await loadHook();

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.storeMessageHistory(
        [
          text('u1', 'user', 'Build me a landing page for a bakery'),
          {
            id: 'a1',
            role: 'assistant',
            parts: [
              { type: 'tool-project_write_file', toolCallId: 'w', state: 'output-available', input: {}, output: {} },
            ],
          } as unknown as UIMessage,
        ],
        false,
      );
    });

    const [chat] = [...h.chats.values()];
    expect(chat.urlId).toBeTruthy();
    expect(chat.description).toBe('Build me a landing page for a bakery');
  });

  it('P14: also names an existing artifact-less chat when its turn ends', async () => {
    const { useChatHistory } = await loadHook();
    seed({ id: '1', messages: [text('u1', 'user', 'Agent please'), text('a1', 'assistant', 'ok')] });

    routeId = '1';

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.storeMessageHistory(
        [text('u1', 'user', 'Agent please'), text('a1', 'assistant', 'ok'), text('u2', 'user', 'more')],
        false,
      );
    });

    expect(h.chats.get('1').urlId).toBe('1');
    expect(h.chats.get('1').description).toBe('Agent please');
  });

  /*
   * P16. Every 50 ms streaming sample sent a full PUT of the conversation.
   */
  it('P16: throttles server pushes while streaming and always pushes the end of the turn', async () => {
    const { useChatHistory } = await loadHook();
    seed({ id: '1', urlId: 'stream', messages: [text('u1', 'user', 'a'), text('a1', 'assistant', 'b')] });

    routeId = 'stream';

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const base = [text('u1', 'user', 'a'), text('a1', 'assistant', 'b'), text('u2', 'user', 'c')];

    await act(async () => {
      for (let i = 0; i < 20; i++) {
        void result.current.storeMessageHistory([...base, text('a2', 'assistant', 'x'.repeat(i + 1))], true);
      }

      await result.current.storeMessageHistory([...base, text('a2', 'assistant', 'final')], false);
    });

    expect(vi.mocked(pushChat).mock.calls.length).toBeLessThanOrEqual(3);

    const lastPush = vi.mocked(pushChat).mock.calls.at(-1)![0] as { messages: UIMessage[]; timestamp: string };
    expect(textOf(lastPush.messages.at(-1)!)).toBe('final');

    // The local record and the server copy carry the same timestamp (no pull-back next sync).
    const lastWrite = vi.mocked(setMessages).mock.calls.at(-1)!;
    expect(lastWrite[5]).toBe(lastPush.timestamp);
  });
});
