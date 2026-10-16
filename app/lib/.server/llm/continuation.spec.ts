import { describe, expect, it } from 'vitest';
import { shouldContinueSegment } from './continuation';
import { getAgentLoopProgress } from '~/lib/common/agentLoop';

describe('shouldContinueSegment', () => {
  it('continues a plain chat answer cut by the token limit', () => {
    expect(shouldContinueSegment({ finishReason: 'length', agentLoopActive: false })).toBe(true);
    expect(shouldContinueSegment({ finishReason: 'stop', agentLoopActive: false })).toBe(false);
  });

  it('does not continue an agent turn with a text segment', () => {
    expect(shouldContinueSegment({ finishReason: 'length', agentLoopActive: true })).toBe(false);
  });

  it('documents why: a continuation user message hides the plan from the agent loop', () => {
    const plan = {
      goal: 'g',
      steps: ['write the page'],
      criteria: [{ id: 'c1', description: 'd' }],
      requiresPreview: false,
    };

    const planned = [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'build a page' }] },
      {
        id: 'a',
        role: 'assistant',
        parts: [{ type: 'tool-agent_plan', toolCallId: 'p', state: 'output-available', input: plan, output: { plan } }],
      },
    ];

    expect(getAgentLoopProgress(planned as never, true).plan).toBeDefined();

    // What the old continuation appended: the truncated text, then a "continue" user message.
    const continued = [
      ...planned,
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Continue your prior response.' }] },
    ];

    expect(getAgentLoopProgress(continued as never, true).plan).toBeUndefined();
  });
});
