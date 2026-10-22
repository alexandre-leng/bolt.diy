// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@nanostores/react', () => ({ useStore: (atom: { get: () => unknown }) => atom.get() }));
vi.mock('~/lib/stores/theme', () => ({ themeStore: { get: () => 'dark', subscribe: () => vi.fn() } }));
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    showTerminal: { get: () => true },
    toggleTerminal: vi.fn(),
    detachTerminal: vi.fn(),
    attachBoltTerminal: vi.fn(),
    attachTerminal: vi.fn(),
    onTerminalResize: vi.fn(),
  },
}));
vi.mock('~/lib/toastify', () => ({
  toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock('./Terminal', () => ({ Terminal: () => <div /> }));
vi.mock('./TerminalManager', () => ({ TerminalManager: () => null }));
vi.mock('./RestartPreviewButton', () => ({ RestartPreviewButton: () => <button /> }));
vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
import { TerminalTabs } from './TerminalTabs';

describe('Terminal tabs accessibility', () => {
  it('labels its tablist and the add-terminal action', () => {
    render(<TerminalTabs />);
    expect(screen.getByRole('tablist', { name: 'Terminaux' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Terminal Bolt' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Nouveau terminal' })).toBeInTheDocument();
  });
});
