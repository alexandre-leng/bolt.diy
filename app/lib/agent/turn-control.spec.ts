import { describe, expect, it } from 'vitest';
import {
  appendSteer,
  applyRedirect,
  buildCheckpoint,
  clearInterrupt,
  createTurnControl,
  drainRedirect,
  drainSteer,
  hasInterruptibleContent,
  hasPendingRedirect,
  INTERRUPT_SCAFFOLD,
  queueRedirect,
  requestStop,
  shouldAcceptStop,
} from './turn-control';

/*
 * These specs pin the five invariants the Hermes port depends on. Each one is written as a
 * regression: the naive implementation (drop the partial, annotate instead of appending a user row,
 * wipe a queue after drain) is what these catch.
 */
describe('steer', () => {
  it('queues guidance without clearing the partial text', () => {
    const state = appendSteer(createTurnControl(), 'utilise plutôt un bleu');

    expect(state.pendingSteer).toBe('utilise plutôt un bleu');
    expect(state.reason).toBeNull();
  });

  it('concatenates repeated guidance instead of replacing it', () => {
    let state = appendSteer(createTurnControl(), 'premier');
    state = appendSteer(state, 'second');

    expect(state.pendingSteer).toBe('premier\nsecond');
  });

  it('ignores empty input', () => {
    const state = createTurnControl();

    expect(appendSteer(state, '   ')).toBe(state);
  });

  it('drains exactly once', () => {
    const state = appendSteer(createTurnControl(), 'x');
    const first = drainSteer(state);

    expect(first.text).toBe('x');
    expect(drainSteer(first.next).text).toBeNull();
  });
});

describe('redirect', () => {
  it('keeps the partial assistant text as a checkpoint', () => {
    const state = queueRedirect(
      { ...createTurnControl(), partialAssistantText: 'Je commence par <h1>' },
      'mets un logo',
    );

    expect(state.pendingRedirect).toBe('mets un logo');
    expect(state.reason).toBe('user_correction');
    expect(state.partialAssistantText).toBe('Je commence par <h1>');
  });

  it('accumulates a second correction under an explicit marker', () => {
    let state = queueRedirect(createTurnControl(), 'première');
    state = queueRedirect(state, 'seconde');

    expect(state.pendingRedirect).toContain('première');
    expect(state.pendingRedirect).toContain('[Correction supplémentaire]');
    expect(state.pendingRedirect).toContain('seconde');
  });

  it('appends an assistant row plus a REAL user row', () => {
    const messages = [
      { role: 'user' as const, content: 'fais une landing' },
      { role: 'assistant' as const, content: '' },
    ];

    const next = applyRedirect(messages, 'Brouillon de héros', 'change le titre');

    /*
     * The tail is already assistant, so no extra assistant row is inserted (see the next test);
     * the correction still becomes a user row carrying the checkpoint for the provider.
     */
    expect(next).toHaveLength(3);
    expect(next[2].role).toBe('user');
    expect(next[2].content).toBe('change le titre');
    expect(next[2].apiContent).toContain(INTERRUPT_SCAFFOLD);
    expect(next[2].apiContent).toContain('Brouillon de héros');
  });

  it('never creates assistant -> assistant', () => {
    const messages = [{ role: 'assistant' as const, content: 'déjà là' }];

    const next = applyRedirect(messages, 'en cours', 'continue');

    expect(next[0].role).toBe('assistant');
    expect(next[1].role).toBe('user');
    expect(next.filter((message) => message.role === 'assistant')).toHaveLength(1);
  });

  it('inserts a hidden placeholder when there is no visible text', () => {
    const next = applyRedirect([{ role: 'user', content: 'go' }], '   ', 'autre chose');

    expect(next[1]).toMatchObject({ role: 'assistant', hidden: true });
    expect(next[2].role).toBe('user');
  });

  it('keeps scaffolding out of the transcript row', () => {
    const next = applyRedirect([{ role: 'user', content: 'go' }], 'partiel', 'corrige');

    expect(next.at(-1)?.content).toBe('corrige');
    expect(next.at(-1)?.apiContent).toContain('partiel');
  });

  it('reports and drains pending corrections', () => {
    const state = queueRedirect(createTurnControl(), 'go');

    expect(hasPendingRedirect(state)).toBe(true);
    expect(drainRedirect(state).text).toBe('go');
    expect(drainRedirect(drainRedirect(state).next).text).toBeNull();
  });
});

describe('stop', () => {
  it('records the reason and drops a queued correction', () => {
    const queued = queueRedirect(createTurnControl(), 'corrige ceci');
    const stopped = requestStop(queued, 'texte partiel');

    expect(stopped.reason).toBe('explicit_stop');
    expect(stopped.pendingRedirect).toBeNull();
    expect(stopped.partialAssistantText).toBe('texte partiel');
  });

  it('refuses a stop aimed at a generation that already ended', () => {
    expect(shouldAcceptStop(4, 4)).toBe(true);
    expect(shouldAcceptStop(4, 5)).toBe(false);
  });

  it('clears the interrupt and can preserve a queued correction', () => {
    const state = queueRedirect(createTurnControl(), 'x');
    const cleared = clearInterrupt(state, true);

    expect(cleared.interrupted).toBe(false);
    expect(cleared.reason).toBeNull();
    expect(cleared.pendingRedirect).toBe('x');
    expect(clearInterrupt(state).pendingRedirect).toBeNull();
  });
});

describe('checkpoint wording', () => {
  it('labels the partial text so the model knows it was cut', () => {
    const checkpoint = buildCheckpoint('Un héros puis des cartes');

    expect(checkpoint).toContain(INTERRUPT_SCAFFOLD);
    expect(checkpoint).toContain('Un héros puis des cartes');
  });

  it('states only the marker when nothing was produced', () => {
    expect(buildCheckpoint('  ')).toBe(INTERRUPT_SCAFFOLD);
  });

  it('knows when there is nothing to attach to', () => {
    expect(hasInterruptibleContent('')).toBe(false);
    expect(hasInterruptibleContent('a')).toBe(true);
  });
});
