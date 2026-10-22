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
