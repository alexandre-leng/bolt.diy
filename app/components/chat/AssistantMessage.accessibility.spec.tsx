// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./Thinking', () => ({ ThinkingDetails: () => null }));
vi.mock('./ToolInvocations', () => ({ ToolInvocations: () => null }));
vi.mock('~/components/ui/Popover', () => ({ default: () => null }));
vi.mock('~/components/ui/Tooltip', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
import { AssistantMessage } from './AssistantMessage';
describe('Assistant message action buttons', () => {
  it('provides named 44px touch targets for rewind and fork', () => {
    render(<AssistantMessage messageId="m1" onRewind={vi.fn()} onFork={vi.fn()} parts={[]} addToolResult={vi.fn()} />);

    const rewind = screen.getByRole('button', { name: 'Revenir à ce message' });
    const fork = screen.getByRole('button', { name: 'Repartir d’ici dans une nouvelle conversation' });
    expect(rewind).toHaveAttribute('type', 'button');
    expect(fork).toHaveAttribute('type', 'button');
    expect(rewind.className).toContain('min-h-11');
    expect(fork.className).toContain('min-w-11');
  });
});
