import { describe, expect, it } from 'vitest';
import { dropFailedTurn } from './failedTurn';

const user = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'build it' }] };

describe('dropFailedTurn', () => {
  it('keeps an interrupted agent turn whose tool calls already wrote files', () => {
    const assistant = {
      id: 'a',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Writing files' },
        { type: 'tool-project_write_file', state: 'output-available', input: { path: 'src/Hero.tsx' }, output: {} },
        { type: 'tool-project_write_file', state: 'input-streaming', input: { path: 'src/Na' } },
        { type: 'tool-project_run_command', state: 'input-available', input: { command: 'npm i' } },
      ],
    };

    const result = dropFailedTurn([user, assistant]);

    expect(result).toHaveLength(2);
    expect((result[1].parts as Array<{ type: string; state?: string }>).map((part) => part.state ?? part.type)).toEqual(
      ['text', 'output-available'],
    );
  });

  it('still drops a failed turn that changed nothing (upstream behaviour)', () => {
    const assistant = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] };

    expect(dropFailedTurn([user, assistant])).toEqual([user]);
  });

  it('drops the unanswered user message when the assistant never replied (upstream behaviour)', () => {
    expect(dropFailedTurn([user])).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(dropFailedTurn([])).toEqual([]);
  });
});
