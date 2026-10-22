/*
 * Control of the RUNNING turn: stop / steer / redirect.
 *
 * Ported from Hermes Agent (`agent/interrupt_control.py` + `agent/conversation_loop.py::
 * _apply_active_turn_redirect`). The property we want is the one Hermes has and bolt.diy lacks:
 * a generation can be interrupted, and what was already produced is KEPT as context while the
 * user's correction becomes a real user message that the turn resumes from.
 *
 * Three distinct operations, deliberately not collapsed into one:
 *
 *   - `explicit_stop`   : the square button. Aborts the request, the turn ends. Nothing resumes.
 *   - `steer(text)`     : no interruption. The text is QUEUED and delivered after the current tool
 *                         batch, so guidance never kills work in progress.
 *   - `redirect(text)`  : the correction. Only the in-flight model request is cancelled, the partial
 *                         assistant text is preserved as a checkpoint, the correction is appended as
 *                         a user message, and the loop STARTS AGAIN with that context.
 *
 * Invariants taken from the source, each one a bug we must not reintroduce:
 *   1. partial text is never lost        -> carried in the checkpoint;
 *   2. the correction is a real user row -> not an annotation, not a system note;
 *   3. role alternation is preserved     -> an assistant row is inserted only when the tail is not
 *                                           already assistant (never assistant -> assistant);
 *   4. a stale stop must not cancel a resumed turn -> `shouldAcceptStop(generation)`;
 *   5. queues are drained at fixed points and drained exactly once.
 *
 * This module is pure: no React, no network, so the hard part is unit-testable.
 */

export type StopReason = 'explicit_stop' | 'user_correction' | 'user_interrupt';

export interface TurnControlState {
  /** A stop or a redirect has been requested for the running turn. */
  interrupted: boolean;
  reason: StopReason | null;

  /** Text to deliver after the current tool batch, without cancelling anything. */
  pendingSteer: string | null;

  /** Correction to apply when the turn resumes (cancels only the model request). */
  pendingRedirect: string | null;

  /** Assistant text already streamed when the interruption arrived. */
  partialAssistantText: string;
}

export interface ControlMessage {
  role: 'user' | 'assistant';
  content: string;

  /**
   * What the provider replays. The transcript shows the user's own words; the model receives the
   * interruption scaffold followed by them. Same split as Hermes (`content` vs `api_content`).
   */
  apiContent?: string;

  /** Hidden from the transcript (an empty placeholder that only keeps role alternation). */
  hidden?: boolean;
}

export const INTERRUPT_SCAFFOLD = '[Contexte de la réponse interrompue]';
export const PARTIAL_LABEL = 'Réponse visible avant l’interruption :';

export function createTurnControl(): TurnControlState {
  return {
    interrupted: false,
    reason: null,
    pendingSteer: null,
    pendingRedirect: null,
    partialAssistantText: '',
  };
}

/** Queue guidance for the next tool boundary. Empty or whitespace text is ignored. */
export function appendSteer(state: TurnControlState, text: string): TurnControlState {
  const cleaned = text.trim();

  if (!cleaned) {
    return state;
  }

  return {
    ...state,
    pendingSteer: state.pendingSteer ? `${state.pendingSteer}\n${cleaned}` : cleaned,
    interrupted: true,
  };
}

/**
 * Request a redirect. Repeated corrections accumulate under an explicit marker, exactly like
 * Hermes does, so a second correction does not silently replace the first.
 */
export function queueRedirect(state: TurnControlState, text: string): TurnControlState {
  const cleaned = text.trim();

  if (!cleaned) {
    return state;
  }

  return {
    ...state,
    pendingRedirect: state.pendingRedirect
      ? `${state.pendingRedirect}\n\n[Correction supplémentaire]\n${cleaned}`
      : cleaned,
    interrupted: true,
    reason: 'user_correction',
    partialAssistantText: currentPartial(state.partialAssistantText),
  };
}

/** Explicit stop: the turn ends, nothing is queued for a resume. */
export function requestStop(state: TurnControlState, partial: string): TurnControlState {
  return {
    ...state,
    interrupted: true,
    reason: 'explicit_stop',
    partialAssistantText: currentPartial(partial),
    pendingRedirect: null,
  };
}

/** Clear the interrupt flag while keeping (or not) a queued correction. */
export function clearInterrupt(state: TurnControlState, preserveRedirect = false): TurnControlState {
  return {
    ...state,
    interrupted: false,
    reason: null,
    pendingSteer: null,
    pendingRedirect: preserveRedirect ? state.pendingRedirect : null,
  };
}

export function drainSteer(state: TurnControlState): { text: string | null; next: TurnControlState } {
  return { text: state.pendingSteer, next: { ...state, pendingSteer: null } };
}

export function drainRedirect(state: TurnControlState): { text: string | null; next: TurnControlState } {
  return { text: state.pendingRedirect, next: { ...state, pendingRedirect: null } };
}

export function hasPendingRedirect(state: TurnControlState): boolean {
  return Boolean(state.pendingRedirect);
}

function currentPartial(partial: string): string {
  return (partial ?? '').trim();
}

/** The interruption scaffold: the visible text first, then the label, never the reverse. */
export function buildCheckpoint(partial: string): string {
  const visible = currentPartial(partial);

  if (!visible) {
    return INTERRUPT_SCAFFOLD;
  }

  return `${INTERRUPT_SCAFFOLD}\n\n${PARTIAL_LABEL}\n${visible}`;
}

/**
 * Append the correction to the live conversation.
 *
 * The checkpoint reaches the MODEL through `apiContent` only: as visible assistant text it gets
 * echoed back as content on the next replay (measured in Hermes, `#81841`), which reads as the model
 * quoting scaffolding at the user.
 */
export function applyRedirect(messages: ControlMessage[], partial: string, correction: string): ControlMessage[] {
  const next = [...messages];
  const visible = currentPartial(partial);
  const tail = next[next.length - 1];

  if (!tail || tail.role !== 'assistant') {
    next.push(visible ? { role: 'assistant', content: visible } : { role: 'assistant', content: '', hidden: true });
  }

  next.push({
    role: 'user',
    content: correction,
    apiContent: `[Context from the interrupted assistant response]\n${buildCheckpoint(visible)}\n\n${correction}`,
  });

  return next;
}

/**
 * A stop requested for turn N must not cancel turn N+1 that already started.
 * Hermes guards this with `require_generation`; the counter is the same idea, in integers.
 */
export function shouldAcceptStop(expectedGeneration: number, currentGeneration: number): boolean {
  return expectedGeneration === currentGeneration;
}

/**
 * True while the assistant is still producing text a redirect can be usefully attached to.
 * With no streamed text there is nothing to preserve, so a redirect degrades to a plain new turn.
 */
export function hasInterruptibleContent(partial: string): boolean {
  return currentPartial(partial).length > 0;
}

/*
 * ---------------------------------------------------------------------------------------------
 * Turn lifecycle: how the chat starts, cancels and finishes turns.
 *
 * Kept here, not in `Chat.client.tsx`, so the races are testable without rendering the chat.
 * The component only wires these to `useChat` and the workbench.
 * ---------------------------------------------------------------------------------------------
 */

/** The flags the AI SDK passes to `onFinish`, for every way a request can end. */
export interface TurnFinishInfo {
  isAbort?: boolean;
  isError?: boolean;
  isDisconnect?: boolean;
}

/** True when the request did not complete normally (stop button, correction, error, network). */
export function isInterruptedFinish(info: TurnFinishInfo): boolean {
  return Boolean(info.isAbort || info.isError || info.isDisconnect);
}

/**
 * Identifies "the chat this work was started for", so post-turn work that awaits can tell when
 * the user moved to another chat in the meantime.
 *
 * `epoch` is bumped by the component on a genuine chat switch. The id alone is not enough: a brand
 * new chat has no id until its first save, and that save legitimately happens while the first
 * turn's follow-up work is awaiting. So an `undefined` captured id accepts the id assigned later,
 * and the epoch catches the switch away from an unsaved chat.
 */
export function createChatGuard(getChatId: () => string | undefined, getEpoch: () => number): () => boolean {
  const startedChat = getChatId();
  const startedEpoch = getEpoch();

  return () => getEpoch() === startedEpoch && (startedChat === undefined || getChatId() === startedChat);
}

export type FirstTurnSetupResult = 'interrupted' | 'chat-changed' | 'no-project' | 'no-setup' | 'applied';

export interface FirstTurnSetupDeps<Commands, SetupMessage> {
  /** The SDK's `onFinish` flags for the turn that just ended. */
  finish: TurnFinishInfo;

  /** From `createChatGuard`, captured when the turn finished. Rechecked after every await. */
  isSameChat: () => boolean;

  /** Synchronous: parse the completed messages so their file actions are queued. */
  prepare: () => void;
  waitForExecutionQueue: () => Promise<void>;
  readProjectFiles: () => Array<{ path: string; content: string }>;
  detectCommands: (files: Array<{ path: string; content: string }>) => Promise<Commands>;
  createSetupMessage: (commands: Commands) => SetupMessage | undefined | null;

  /** Append and persist the setup message. Only called for the chat the turn belonged to. */
  commit: (setup: SetupMessage) => Promise<void>;
}

/**
 * After the FIRST turn of a project, synthesise the install + start actions the model did not
 * emit itself.
 *
 * An interrupted turn (stop, correction, error, disconnect) never gets a setup: its files are
 * partial, and launching `npm install` plus a dev server after the user pressed Stop is exactly
 * what they asked not to happen. Every await is followed by a chat check, so the setup of one chat
 * is never injected into (and persisted as) another.
 */
export async function runFirstTurnSetup<Commands, SetupMessage>(
  deps: FirstTurnSetupDeps<Commands, SetupMessage>,
): Promise<FirstTurnSetupResult> {
  if (isInterruptedFinish(deps.finish)) {
    return 'interrupted';
  }

  if (!deps.isSameChat()) {
    return 'chat-changed';
  }

  deps.prepare();
  await deps.waitForExecutionQueue();

  if (!deps.isSameChat()) {
    return 'chat-changed';
  }

  const files = deps.readProjectFiles();

  // A research-only conversation has no project to install or start.
  if (files.length === 0) {
    return 'no-project';
  }

  const commands = await deps.detectCommands(files);

  if (!deps.isSameChat()) {
    return 'chat-changed';
  }

  const setup = deps.createSetupMessage(commands);

  if (!setup) {
    return 'no-setup';
  }

  await deps.commit(setup);

  return 'applied';
}

/** Upper bound on how long a cancelled request may take to settle before the next turn starts. */
export const CANCEL_SETTLE_TIMEOUT_MS = 5000;

export interface TurnControllerHooks {
  /** Cancel the in-flight MODEL request only (`useChat().stop`). */
  stopModel: () => unknown;

  /** Cancel the workbench actions (installs, dev server). Reserved for the explicit stop button. */
  abortActions: () => void;
}

/**
 * What `TurnController.interrupt()` decided.
 *
 * - `stale`: aimed at a turn that is no longer the current one, nothing was cancelled by this call.
 * - `next-turn`: the model request was cancelled and there is nothing to keep, send the text as a
 *   plain turn.
 * - `redirect`: the model request was cancelled and the partial answer stays in the transcript as
 *   context. `visibleText` is what the user typed and the ONLY text that may be shown or persisted;
 *   `apiContent` is the scaffold for a provider channel and must never become a visible part.
 */
export type InterruptOutcome =
  { kind: 'stale' } | { kind: 'next-turn' } | { kind: 'redirect'; visibleText: string; apiContent: string };

/**
 * Owns the lifecycle of chat turns: generation counter, the in-flight turn, the send lock, and the
 * stop / steer / redirect state.
 *
 * - Every turn starts through `start()`, which bumps the generation and waits for the previous
 *   turn to settle. The SDK resolves `sendMessage` only after its request's `finally`, so a new
 *   turn can never be overwritten by the late `ready` status (and `onFinish`) of the one it
 *   replaced.
 * - `interrupt()` (a message typed during generation) cancels ONLY the model request and waits for
 *   it; it never touches the workbench, so a running dev server or install survives a correction.
 * - `abort()` is the square button: model request AND workbench actions.
 * - Steer is not used on this path: the text typed during a turn that has produced nothing yet is
 *   sent as the next turn, so queuing it as steer too would deliver it twice. `pendingSteer` is
 *   therefore always cleared when a turn starts.
 */
export class TurnController {
  #generation = 0;
  #inflight: Promise<void> | null = null;
  #locked = false;
  #state: TurnControlState = createTurnControl();
  readonly #hooks: TurnControllerHooks;

  constructor(hooks: TurnControllerHooks) {
    this.#hooks = hooks;
  }

  /** Identifies the current turn. Capture it when the user acts, compare it after any await. */
  get generation(): number {
    return this.#generation;
  }

  get state(): TurnControlState {
    return this.#state;
  }

  /** A turn was started through `start()` and its request has not settled yet. */
  get inFlight(): boolean {
    return this.#inflight !== null;
  }

  /**
   * Start a new turn. Synchronously claims a new generation and clears the interrupt state, then
   * dispatches once the previous turn (if any) has settled. Returns the dispatch's own promise.
   */
  start(dispatch: () => Promise<unknown>): Promise<void> {
    const previous = this.#inflight;

    this.#generation += 1;
    this.#state = clearInterrupt(this.#state);

    const run = (async () => {
      if (previous) {
        await previous;
      }

      await dispatch();
    })();

    const settled = run.then(
      () => undefined,
      () => undefined,
    );

    this.#inflight = settled;
    void settled.then(() => {
      if (this.#inflight === settled) {
        this.#inflight = null;
      }
    });

    return run;
  }

  /**
   * Cancel the model request and wait (bounded) for the in-flight turn to settle. Does NOT touch
   * the workbench.
   */
  async cancelModelRequest(timeoutMs = CANCEL_SETTLE_TIMEOUT_MS): Promise<void> {
    const inflight = this.#inflight;

    await Promise.resolve(this.#hooks.stopModel());

    if (!inflight) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    await Promise.race([
      inflight,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);

    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }

  /** The square button: ends the turn, its model request AND the workbench actions. */
  abort(partial: string): void {
    this.#state = requestStop(this.#state, partial);
    void this.#hooks.stopModel();
    this.#hooks.abortActions();
  }

  /**
   * A message typed while a turn runs.
   *
   * @param actingGeneration `generation` captured when the user pressed send, before any await.
   * @param partial the assistant text streamed so far, captured BEFORE cancelling (the finish
   *   callback of the cancelled request clears it).
   */
  async interrupt(args: { text: string; partial: string; actingGeneration: number }): Promise<InterruptOutcome> {
    const { text, partial, actingGeneration } = args;

    if (!shouldAcceptStop(actingGeneration, this.#generation)) {
      return { kind: 'stale' };
    }

    /* After the square button, what the user types next is a new request, not a correction. */
    const afterExplicitStop = this.#state.reason === 'explicit_stop';

    await this.cancelModelRequest();

    /* Another turn started while we waited: do not redirect into it. */
    if (!shouldAcceptStop(actingGeneration, this.#generation)) {
      return { kind: 'stale' };
    }

    if (afterExplicitStop || !hasInterruptibleContent(partial)) {
      this.#state = clearInterrupt(this.#state);
      return { kind: 'next-turn' };
    }

    const drained = drainRedirect(queueRedirect(this.#state, text));
    this.#state = clearInterrupt(drained.next);

    if (!drained.text) {
      return { kind: 'next-turn' };
    }

    /*
     * The partial assistant row is already in the transcript (the SDK appended it while streaming),
     * so the hidden placeholder `applyRedirect` would add is not needed: pass an assistant tail.
     */
    const row = applyRedirect([{ role: 'assistant', content: partial }], partial, drained.text).at(-1)!;

    return { kind: 'redirect', visibleText: row.content, apiContent: row.apiContent ?? row.content };
  }

  /**
   * Run the composer's send under a lock: a second press while the first is still being prepared
   * (template selection, file reading, waiting for a cancelled request) is ignored instead of
   * starting a parallel turn. Returns `undefined` when the call was rejected.
   */
  async exclusive<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (this.#locked) {
      return undefined;
    }

    this.#locked = true;

    try {
      return await fn();
    } finally {
      this.#locked = false;
    }
  }
}
