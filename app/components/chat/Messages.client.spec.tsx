import { render, screen } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

/*
 * P3. The restore's replay message is never stored and has a generated id: Rewind on it sent
 * `?rewindTo=<unknown id>`, which emptied the conversation (and the next save erased it);
 * Fork on it failed with "Message not found". Only the snapshot-restore message, which
 * carries a stored message's id, may keep them.
 */
vi.mock('./AssistantMessage', () => ({
  AssistantMessage: (props: { messageId?: string; onRewind?: unknown; onFork?: unknown }) => (
    <div data-testid={`assistant-${props.messageId}`}>
      {props.onRewind ? <button aria-label="Revenir à ce message">rewind {props.messageId}</button> : null}
      {props.onFork ? <button aria-label="Repartir d’ici dans une nouvelle conversation">fork {props.messageId}</button> : null}
    </div>
  ),
}));
vi.mock('./UserMessage', () => ({ UserMessage: () => <div /> }));
vi.mock('./Thinking', () => ({ isModelThinking: () => false, ThinkingIndicator: () => null }));
vi.mock('~/lib/persistence/useChatHistory', () => ({ db: undefined, chatId: { get: () => undefined } }));
vi.mock('~/lib/persistence/db', () => ({ forkChat: vi.fn() }));
vi.mock('react-router', () => ({ useLocation: () => ({ search: '' }), useNavigate: () => vi.fn() }));

const { Messages } = await import('./Messages.client');

const assistant = (id: string, flags?: string[]) =>
  ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: id }],
    ...(flags ? { metadata: { flags } } : {}),
  }) as UIMessage;

describe('Messages rewind/fork controls', () => {
  it('offers Rewind and Fork on stored messages only', () => {
    render(
      <Messages
        messages={[
          assistant('stored'),
          assistant('replay', ['no-store']),
          assistant('restored-snapshot', ['no-store', 'rewindable']),
        ]}
        addToolResult={vi.fn()}
      />,
    );

    expect(screen.getByText('rewind stored')).toBeTruthy();
    expect(screen.getByText('fork stored')).toBeTruthy();
    expect(screen.queryByText('rewind replay')).toBeNull();
    expect(screen.queryByText('fork replay')).toBeNull();
    expect(screen.getByText('rewind restored-snapshot')).toBeTruthy();
  });
});
