import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Projects panel (audit U4, U13, U16, U17), rendered for real with persistence mocked.
 */
const chats = [
  {
    id: '7',
    urlId: 'site-cafe',
    description: 'Site café',
    messages: [{ role: 'user' }],
    timestamp: new Date().toISOString(),
  },
];

const mocks = vi.hoisted(() => ({
  deleteById: vi.fn(async () => undefined),
  deleteHistory: vi.fn(),
  markDeleted: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('~/lib/persistence', async () => {
  const { atom } = await import('nanostores');

  return {
    db: {} as IDBDatabase,
    deleteById: mocks.deleteById,
    getAll: vi.fn(async () => chats),
    getCachedMessages: vi.fn(async () => ({ urlId: 'site-cafe' })),
    getMessages: vi.fn(async () => undefined),
    invalidateChatCache: vi.fn(),
    prefetchChat: vi.fn(),
    updateChatDescription: vi.fn(),
    chatId: atom<string | undefined>(undefined),
    description: atom<string | undefined>(undefined),
    useChatHistory: () => ({ duplicateCurrentChat: vi.fn(), exportChat: vi.fn() }),
  };
});

vi.mock('~/lib/persistence/historySync', () => ({
  PULL_BATCH_SIZE: 6,
  migrateLocalHistoryToServer: vi.fn(async () => ({ offline: false, pulled: 0, pushed: 0, failed: 0, pending: [] })),
  markDeleted: mocks.markDeleted,
  renameChat: vi.fn(),
}));

vi.mock('~/lib/persistence/syncClient', () => ({ deleteHistory: mocks.deleteHistory }));
vi.mock('~/lib/toastify', () => ({ toast: mocks.toast }));
vi.mock('~/components/@settings/core/ControlPanel', () => ({ ControlPanel: () => null }));
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('~/components/ui/DocumentationPanel', () => ({ DocumentationPanel: () => null }));

import { Menu } from './Menu.client';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore } from '~/lib/stores/sidebar';

async function renderMenu() {
  const view = render(
    <MemoryRouter>
      <Menu />
    </MemoryRouter>,
  );

  await screen.findByText('Site café');

  return view;
}

async function openDeleteDialog(container: HTMLElement) {
  act(() => {
    fireEvent.click(container.querySelector('button.i-ph\\:trash') as HTMLButtonElement);
  });

  return screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  chatStore.setKey('started', false);
  sidebarOpenStore.set(true);
});

describe('Menu: failed server delete (U17)', () => {
  it('keeps the local copy and reports the failure in French', async () => {
    mocks.deleteHistory.mockResolvedValue({ ok: false, error: 'HTTP 500' });

    const { container } = await renderMenu();
    const dialog = await openDeleteDialog(container);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^(Supprimer|Delete)$/ }));
    });

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());

    // Before: deleted locally anyway, with a success toast, and it came back from the server.
    expect(mocks.deleteById).not.toHaveBeenCalled();
    expect(mocks.markDeleted).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(String(mocks.toast.error.mock.calls[0][0])).toMatch(/suppression/i);
  });

  it('treats a 404 (already gone on the server) as success', async () => {
    mocks.deleteHistory.mockResolvedValue({ ok: false, error: 'HTTP 404' });

    const { container } = await renderMenu();
    const dialog = await openDeleteDialog(container);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^(Supprimer|Delete)$/ }));
    });

    await waitFor(() => expect(mocks.deleteById).toHaveBeenCalledWith(expect.anything(), '7'));
  });
});

describe('Menu: delete dialog (U16)', () => {
  it('closes on Escape', async () => {
    const { container } = await renderMenu();
    const dialog = await openDeleteDialog(container);

    act(() => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is in French', async () => {
    const { container } = await renderMenu();
    const dialog = await openDeleteDialog(container);

    expect(within(dialog).getByText('Supprimer la conversation ?')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeTruthy();
  });
});

describe('Menu: settings from a conversation on a phone (U4)', () => {
  function settingsSlot(container: HTMLElement) {
    const button = container.querySelector('button[title="Réglages"], button[title="Preferences"]') as HTMLElement;

    return button.parentElement as HTMLElement;
  }

  it('shows the settings button on every width once a conversation is open', async () => {
    chatStore.setKey('started', true);

    const { container } = await renderMenu();

    // The mobile bottom navigation is not rendered in a conversation: this is the only way in.
    expect(settingsSlot(container).className.split(/\s+/)).not.toContain('hidden');
  });

  it('leaves it to the bottom navigation on the landing page', async () => {
    const { container } = await renderMenu();

    expect(settingsSlot(container).className.split(/\s+/)).toContain('hidden');
  });
});

describe('Menu: French chrome (U13)', () => {
  it('labels the panel in French', async () => {
    await renderMenu();

    expect(screen.getByText('Vos conversations')).toBeTruthy();
    expect(screen.getByText('Nouvelle conversation')).toBeTruthy();
    expect(screen.getByLabelText('Rechercher une conversation')).toBeTruthy();
  });
});

/*
 * One close handle (user: "3 boutons qui font la même tâche, on pourrait fusionner").
 *
 * The panel carried its own close chevron AND a floating edge chevron; both duplicated the
 * header toggle, and the close chevron drew the same icon as the header's back control while
 * doing the opposite. The panel must now expose neither: closing happens in the header, which
 * is painted above the panel.
 */
describe('Menu: a single open/close handle', () => {
  it('has no close button of its own', async () => {
    const { container } = await renderMenu();

    expect(container.querySelector('[data-testid="sidebar-close"]')).toBeNull();
    expect(screen.queryByLabelText('Fermer le panneau')).toBeNull();
  });

  it('renders no floating trigger pinned to the left edge', async () => {
    const { container } = await renderMenu();

    /*
     * The panel is open here: the old trigger only appeared when closed, so check the markup
     * for the class signature instead of relying on state.
     */
    expect(container.innerHTML).not.toContain('top-[72px]');
    expect(screen.queryByLabelText('Ouvrir le panneau')).toBeNull();
  });

  it('exposes the panel id the header toggle points at', async () => {
    const { container } = await renderMenu();

    expect(container.querySelector('#sidebar-panel')).toBeTruthy();
  });

  it('keeps a single exit from selection mode, labelled', async () => {
    await renderMenu();

    act(() => {
      fireEvent.click(screen.getByLabelText('Sélectionner des conversations'));
    });

    const exits = screen.getAllByLabelText('Quitter la sélection');
    expect(exits.length).toBe(1);
  });
});
