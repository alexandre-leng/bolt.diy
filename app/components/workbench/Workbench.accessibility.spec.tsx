// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('nanostores', async () => {
  const actual = await vi.importActual<typeof import('nanostores')>('nanostores');
  return { ...actual, computed: () => ({ get: () => false, subscribe: () => vi.fn() }) };
});
vi.mock('@nanostores/react', () => ({
  useStore: (atom: unknown) =>
    atom && typeof atom === 'object' && 'get' in atom ? (atom as { get: () => unknown }).get() : atom,
}));
vi.mock('~/lib/stores/chat', () => ({ chatStore: { showChat: { get: () => true }, setKey: vi.fn() } }));
vi.mock('~/lib/stores/streaming', () => ({ streamingState: { get: () => false } }));
vi.mock('~/lib/stores/theme', () => ({ themeStore: { get: () => 'dark', subscribe: () => vi.fn() } }));
vi.mock('~/lib/stores/previews', () => ({}));
vi.mock('~/lib/stores/workbench', () => {
  const atom = (value: unknown) => ({
    get: () => value,
    set: vi.fn(),
    subscribe: () => vi.fn(),
    listen: () => vi.fn(),
  });
  return {
    workbenchStore: {
      previews: atom([]),
      showWorkbench: atom(true),
      selectedFile: atom(undefined),
      currentDocument: atom(undefined),
      unsavedFiles: atom(new Set()),
      files: atom({}),
      currentView: atom('preview'),
      showTerminal: atom(false),
      userSelectedView: atom(undefined),
      previewRestoreToken: atom(0),
      selectWorkbenchView: vi.fn(),
      setDocuments: vi.fn(),
      setSelectedFile: vi.fn(),
      saveCurrentDocument: vi.fn(),
      resetCurrentDocument: vi.fn(),
      syncFiles: vi.fn(),
      downloadZip: vi.fn(),
    },
  };
});
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => null,
}));
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  const React = await import('react');

  return {
    ...actual,
    motion: {
      div: React.forwardRef(
        ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>, ref: React.ForwardedRef<HTMLDivElement>) => (
          <div ref={ref} {...props}>
            {children}
          </div>
        ),
      ),
    },
  };
});
vi.mock('~/lib/hooks', () => ({ default: () => false }));
vi.mock('~/lib/toastify', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('./EditorPanel', () => ({ EditorPanel: () => <button>Editeur</button> }));
vi.mock('./terminal/TerminalTabs', () => ({ TerminalTabs: () => <div /> }));
vi.mock('./Preview', () => ({ Preview: () => <button>Aperçu</button> }));
vi.mock('./folderSync', () => ({ canSyncToFolder: () => false }));
vi.mock('~/components/chat/chatExportAndImport/ExportChatButton', () => ({
  ExportChatButton: () => <button>Exporter</button>,
}));
vi.mock('~/components/ui/Slider', () => ({ Slider: () => <button>Vue</button> }));
vi.mock('~/components/ui/IconButton', () => ({ IconButton: () => <button>Fermer</button> }));
import { Workbench } from './Workbench.client';
describe('Workbench accessibility', () => {
  it('marks the hidden code pane inert and aria-hidden', () => {
    render(<Workbench chatStarted />);

    const codeView = screen.getByTestId('workbench-code-view');
    expect(codeView).toHaveAttribute('aria-hidden', 'true');
    expect(codeView).toHaveAttribute('inert');
  });
});
