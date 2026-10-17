import { describe, expect, it } from 'vitest';
import { chainSegments, shouldContinueSegment } from './continuation';
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

describe('chainSegments', () => {
  function streamOf(parts: { type: string; text?: string }[]): ReadableStream<any> {
    return new ReadableStream<any>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    });
  }

  function segment(text: string): ReadableStream<{ type: string; text?: string }> {
    return streamOf([{ type: 'text-delta', text }, { type: 'finish' }]) as unknown as ReadableStream<{
      type: string;
      text?: string;
    }>;
  }

  async function collect(stream: ReadableStream<{ type: string; text?: string }>) {
    const events: { type: string; text?: string }[] = [];
    const reader = stream.getReader();

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      events.push(value);
    }

    return events;
  }

  it('plays segments in order and sends the single `finish` last', async () => {
    let continuation: ReadableStream<{ type: string; text?: string }> | undefined = segment('part2');

    const events = await collect(
      chainSegments(segment('part1') as never, () => {
        const next = continuation;
        continuation = undefined;

        return next as never;
      }),
    );

    const texts = events.filter((event) => event.type === 'text-delta').map((event) => event.text);
    expect(texts).toEqual(['part1', 'part2']);

    // The defect: `finish` before the continuation text ended the message in the client.
    expect(events.findIndex((event) => event.type === 'finish')).toBe(events.length - 1);
    expect(events.filter((event) => event.type === 'finish')).toHaveLength(1);
  });
});
