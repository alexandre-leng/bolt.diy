/*
 * Regression specs for the turn lifecycle of the chat (audit 1022, ST-2 to ST-7).
 *
 * `Chat.client.tsx` cannot be rendered without mocking most of the app, so the logic it got wrong
 * was moved into `turn-control.ts` (`runFirstTurnSetup`, `createChatGuard`, `TurnController`) and
 * is tested here; the component only wires it. ST-3 runs against the real `AbstractChat` of the
 * `ai` package, so the status race is the SDK's own behaviour, not a model of it.
 */
import { AbstractChat, type UIMessage, type UIMessageChunk } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { createChatGuard, INTERRUPT_SCAFFOLD, runFirstTurnSetup, TurnController } from './turn-control';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setupDeps(overrides: Partial<Parameters<typeof runFirstTurnSetup<string[], { id: string }>>[0]> = {}) {
  const commit = vi.fn(async (_setup: { id: string }) => undefined);

  const deps = {
    finish: { isAbort: false, isError: false, isDisconnect: false },
    isSameChat: () => true,
    prepare: vi.fn(),
    waitForExecutionQueue: vi.fn(async () => undefined),
    readProjectFiles: () => [{ path: '/home/project/package.json', content: '{}' }],
    detectCommands: vi.fn(async () => ['npm install', 'npm run dev']),
    createSetupMessage: () => ({ id: 'project-setup' }),
    commit,
    ...overrides,
  };

  return deps;
}

describe('ST-2: no project setup after an interrupted first turn', () => {
  it.each([
    ['Stop', { isAbort: true, isError: false, isDisconnect: false }],
    ['erreur', { isAbort: false, isError: true, isDisconnect: false }],
    ['coupure réseau', { isAbort: false, isError: true, isDisconnect: true }],
  ])('after %s, neither install nor dev server is synthesised', async (_label, finish) => {
    const deps = setupDeps({ finish });

    await expect(runFirstTurnSetup(deps)).resolves.toBe('interrupted');
    expect(deps.waitForExecutionQueue).not.toHaveBeenCalled();
    expect(deps.detectCommands).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('a completed first turn still gets its setup', async () => {
    const deps = setupDeps();

    await expect(runFirstTurnSetup(deps)).resolves.toBe('applied');
    expect(deps.commit).toHaveBeenCalledWith({ id: 'project-setup' });
  });

  it('never injects the setup into the chat the user switched to during the wait', async () => {
    let currentChat: string | undefined = 'chat-A';
    let epoch = 0;

    const isSameChat = createChatGuard(
      () => currentChat,
      () => epoch,
    );

    const deps = setupDeps({
      isSameChat,
      waitForExecutionQueue: vi.fn(async () => {
        currentChat = 'chat-B';
        epoch += 1;
      }),
    });

    await expect(runFirstTurnSetup(deps)).resolves.toBe('chat-changed');
    expect(deps.detectCommands).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('rechecks the chat after detecting the commands too', async () => {
    let epoch = 0;

    const deps = setupDeps({
      isSameChat: createChatGuard(
        () => undefined,
        () => epoch,
      ),
      detectCommands: vi.fn(async () => {
        epoch += 1;
        return ['npm install'];
      }),
    });

    await expect(runFirstTurnSetup(deps)).resolves.toBe('chat-changed');
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('accepts the id a brand new chat receives from its first save', () => {
    const current: { chat?: string } = {};

    const isSameChat = createChatGuard(
      () => current.chat,
      () => 0,
    );

    current.chat = 'chat-new';
    expect(isSameChat()).toBe(true);
  });
});

/* A minimal in-memory state for the real AbstractChat. */
class State {
  status: any = 'ready';
  error: any = undefined;
  messages: UIMessage[] = [];
  pushMessage = (message: UIMessage) => {
    this.messages = [...this.messages, message];
  };
  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
  };
  replaceMessage = (index: number, message: UIMessage) => {
    this.messages = this.messages.map((item, i) => (i === index ? message : item));
  };
  snapshot = <T>(value: T): T => structuredClone(value);
}

class TestChat extends AbstractChat<UIMessage> {
  constructor(options: any) {
    super({ ...options, state: new State() });
  }
}

function hangingStream(signal: AbortSignal, text: string) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: 'start' } as UIMessageChunk);
      controller.enqueue({ type: 'text-start', id: 't' } as UIMessageChunk);
      controller.enqueue({ type: 'text-delta', id: 't', delta: text } as UIMessageChunk);

      /* A cancelled request takes a moment to wind down, as a real fetch does. */
      signal.addEventListener('abort', () => {
        setTimeout(() => controller.error(new DOMException('aborted', 'AbortError')), 30);
      });
    },
  });
}

const userMessage = (id: string, text: string) => ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage;

function slowSecondTurnChat() {
  let call = 0;

  const finishes: Array<{ isAbort: boolean; at: number }> = [];
  const requests: Array<{ at: number; text: string }> = [];

  const chat = new TestChat({
    transport: {
      sendMessages: async ({ abortSignal, messages }: { abortSignal: AbortSignal; messages: UIMessage[] }) => {
        call += 1;

        const last = messages.at(-1);
        requests.push({
          at: performance.now(),
          text: (last?.parts ?? []).map((part: any) => part.text ?? '').join(''),
        });

        if (call > 1) {
          // The next turn waits 200 ms for its first byte (a realistic provider latency).
          await sleep(200);
        }

        return hangingStream(abortSignal, call === 1 ? 'partiel' : 'second');
      },
      reconnectToStream: async () => null,
    },
    onFinish: ({ isAbort }: { isAbort: boolean }) => finishes.push({ isAbort, at: performance.now() }),
  });

  return { chat, finishes, requests };
}

describe('ST-3: a correction waits for the cancelled turn before starting the next one', () => {
  it('the new turn stays in flight (not "ready") until its answer arrives', async () => {
    const { chat, finishes, requests } = slowSecondTurnChat();
    const turns = new TurnController({ stopModel: () => chat.stop(), abortActions: vi.fn() });

    void turns.start(() => chat.sendMessage(userMessage('u1', 'premier')));
    await sleep(20);
    expect(chat.status).toBe('streaming');

    const acting = turns.generation;
    const outcome = await turns.interrupt({ text: 'correction', partial: 'partiel', actingGeneration: acting });

    expect(outcome.kind).toBe('redirect');

    // The cancelled turn has fully finished BEFORE the next request is sent.
    expect(finishes).toHaveLength(1);
    expect(finishes[0].isAbort).toBe(true);

    void turns.start(() => chat.sendMessage(userMessage('u2', 'correction')));
    await sleep(50);

    expect(requests).toHaveLength(2);
    expect(finishes[0].at).toBeLessThanOrEqual(requests[1].at);
    expect(chat.status).toBe('submitted');
    expect(turns.inFlight).toBe(true);

    await turns.cancelModelRequest();
  });

  it('a correction sent before the first byte does not let the cancelled request reset the new turn', async () => {
    let call = 0;

    const finishes: boolean[] = [];

    const chat = new TestChat({
      transport: {
        sendMessages: async ({ abortSignal }: { abortSignal: AbortSignal }) => {
          call += 1;

          if (call === 1) {
            /* Waiting for the response headers; a cancelled fetch rejects a moment after abort(). */
            return new Promise<ReadableStream<UIMessageChunk>>((_resolve, reject) => {
              abortSignal.addEventListener('abort', () => {
                setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 30);
              });
            });
          }

          await sleep(200);

          return hangingStream(abortSignal, 'second');
        },
        reconnectToStream: async () => null,
      },
      onFinish: ({ isAbort }: { isAbort: boolean }) => finishes.push(isAbort),
    });

    const turns = new TurnController({ stopModel: () => chat.stop(), abortActions: vi.fn() });

    void turns.start(() => chat.sendMessage(userMessage('u1', 'premier')));
    await sleep(10);
    expect(chat.status).toBe('submitted');

    await turns.interrupt({ text: 'correction', partial: 'partiel', actingGeneration: turns.generation });
    void turns.start(() => chat.sendMessage(userMessage('u2', 'correction')));

    await sleep(80);

    expect(call).toBe(2);
    expect(chat.status).toBe('submitted');

    await turns.cancelModelRequest();
  });

  it('a turn started while another is in flight is serialised behind it', async () => {
    const order: string[] = [];

    let releaseFirst!: () => void;

    const turns = new TurnController({ stopModel: () => undefined, abortActions: vi.fn() });

    void turns.start(
      () =>
        new Promise<void>((resolve) => {
          order.push('first:start');

          releaseFirst = () => {
            order.push('first:end');
            resolve();
          };
        }),
    );
    void turns.start(async () => {
      order.push('second:start');
    });

    await sleep(5);
    expect(order).toEqual(['first:start']);

    releaseFirst();
    await sleep(5);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('locks the composer against a double send', async () => {
    const turns = new TurnController({ stopModel: () => undefined, abortActions: vi.fn() });
    const sent: string[] = [];

    let release!: () => void;

    const first = turns.exclusive(
      () =>
        new Promise<void>((resolve) => {
          sent.push('a');
          release = resolve;
        }),
    );
    const second = await turns.exclusive(async () => {
      sent.push('b');
      return 'sent';
    });

    expect(second).toBeUndefined();
    release();
    await first;
    expect(sent).toEqual(['a']);
  });
});

describe('ST-4: the correction shows only the user words', () => {
  it('keeps the interruption scaffold out of the visible text', async () => {
    const turns = new TurnController({ stopModel: () => undefined, abortActions: vi.fn() });
    void turns.start(() => sleep(1));

    const outcome = await turns.interrupt({
      text: 'mets un logo',
      partial: 'Je commence par le héros <h1>Accueil</h1>',
      actingGeneration: turns.generation,
    });

    expect(outcome).toMatchObject({ kind: 'redirect', visibleText: 'mets un logo' });

    if (outcome.kind === 'redirect') {
      expect(outcome.visibleText).not.toContain(INTERRUPT_SCAFFOLD);
      expect(outcome.visibleText).not.toContain('Je commence par le héros');
      expect(outcome.visibleText).not.toContain('[Correction');
      expect(outcome.apiContent).toContain(INTERRUPT_SCAFFOLD);
    }
  });
});

describe('ST-5: a correction cancels only the model request', () => {
  it('interrupt() never aborts the workbench actions (dev server, install)', async () => {
    const stopModel = vi.fn();
    const abortActions = vi.fn();
    const turns = new TurnController({ stopModel, abortActions });
    void turns.start(() => sleep(1));

    await turns.interrupt({ text: 'corrige', partial: 'texte partiel', actingGeneration: turns.generation });

    expect(stopModel).toHaveBeenCalledTimes(1);
    expect(abortActions).not.toHaveBeenCalled();
  });

  it('the square button still stops both', () => {
    const stopModel = vi.fn();
    const abortActions = vi.fn();
    const turns = new TurnController({ stopModel, abortActions });

    turns.abort('partiel');

    expect(stopModel).toHaveBeenCalledTimes(1);
    expect(abortActions).toHaveBeenCalledTimes(1);
    expect(turns.state.reason).toBe('explicit_stop');
  });

  it('after the square button, the next message is a new turn, not a correction', async () => {
    const turns = new TurnController({ stopModel: () => undefined, abortActions: vi.fn() });
    void turns.start(() => sleep(1));
    turns.abort('partiel');

    const outcome = await turns.interrupt({
      text: 'autre chose',
      partial: 'partiel',
      actingGeneration: turns.generation,
    });

    expect(outcome.kind).toBe('next-turn');
  });
});

describe('ST-7: the generation guard and the steer queue are live', () => {
  it('every turn start claims a new generation', () => {
    const turns = new TurnController({ stopModel: () => undefined, abortActions: vi.fn() });
    const before = turns.generation;

    void turns.start(async () => undefined);
    void turns.start(async () => undefined);

    expect(turns.generation).toBe(before + 2);
  });

  it('a correction aimed at a turn that was replaced does not cancel the new one', async () => {
    const stopModel = vi.fn();
    const turns = new TurnController({ stopModel, abortActions: vi.fn() });

    void turns.start(() => sleep(1));

    const acting = turns.generation; // captured at the click
    void turns.start(() => sleep(1)); // another turn starts before the interruption runs

    const outcome = await turns.interrupt({ text: 'corrige', partial: 'partiel', actingGeneration: acting });

    expect(outcome.kind).toBe('stale');
    expect(stopModel).not.toHaveBeenCalled();
  });

  it('a message with nothing to keep is a new turn, never a stranded steer', async () => {
    const turns = new TurnController({ stopModel: () => undefined, abortActions: vi.fn() });
    void turns.start(() => sleep(1));

    const outcome = await turns.interrupt({ text: 'plutôt en bleu', partial: '', actingGeneration: turns.generation });

    expect(outcome.kind).toBe('next-turn');
    expect(turns.state.pendingSteer).toBeNull();
    expect(turns.state.interrupted).toBe(false);
  });

  it('the interrupt flag does not stay set across turns', async () => {
    const turns = new TurnController({ stopModel: () => undefined, abortActions: vi.fn() });
    void turns.start(() => sleep(1));
    turns.abort('partiel');
    expect(turns.state.interrupted).toBe(true);

    void turns.start(() => sleep(1));

    expect(turns.state.interrupted).toBe(false);
    expect(turns.state.reason).toBeNull();
  });
});
