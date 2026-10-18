import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Regression: bulk delete must remove exactly the chats the confirmation dialog listed.
 *
 * `handleBulkDeleteClick` builds `dialogContent.items` once, and the dialog names and counts
 * them. The confirm button used to delete the LIVE `selectedItems` instead, so deselecting an
 * entry — or a sync shrinking the selection — while the dialog was open deleted a different
 * set than the one the user confirmed.
 */
const chats = [
  {
    id: '7',
    urlId: 'site-cafe',
    description: 'Site café',
    messages: [{ role: 'user' }],
    timestamp: new Date().toISOString(),
  },
  {
    id: '8',
    urlId: 'site-boulangerie',
    description: 'Site boulangerie',
    messages: [{ role: 'user' }],
    timestamp: new Date().toISOString(),
  },
];

const mocks = vi.hoisted(() => ({
  deleteById: vi.fn(async () => undefined),
  deleteHistory: vi.fn(async () => ({ ok: true })),
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
  migrateLocalHistoryToServer: vi.fn(async () => ({ offline: false, pulled: 0, pushed: 0 })),
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
  await screen.findByText('Site boulangerie');

  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  chatStore.setKey('started', false);
  sidebarOpenStore.set(true);
});

describe('Menu: bulk delete matches the confirmation (bulk-delete mismatch)', () => {
  it('deletes exactly the chats the dialog listed, not the live selection', async () => {
    const { container } = await renderMenu();

    // Enter selection mode.
    act(() => {
      fireEvent.click(screen.getByLabelText('Sélectionner des conversations'));
    });

    /*
     * Scope the list clicks to the sidebar list, so the dialog's own rendering of the
     * same description never matches.
     */
    const clickListItem = (description: string) => {
      const rows = Array.from(container.querySelectorAll('.truncate')) as HTMLElement[];
      const row = rows.find((element) => element.textContent === description);

      if (!row) {
        throw new Error(`List row not found: ${description}`);
      }

      act(() => {
        fireEvent.click(row);
      });
    };

    // Select both chats.
    clickListItem('Site café');
    clickListItem('Site boulangerie');

    // Open the bulk-delete confirmation: it now lists and counts 2 conversations.
    act(() => {
      fireEvent.click(screen.getByText('Supprimer la sélection'));
    });

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2 conversations');
    expect(dialog.textContent).toContain('Site café');
    expect(dialog.textContent).toContain('Site boulangerie');

    // The selection shrinks while the dialog is open.
    clickListItem('Site café');

    // Confirm.
    act(() => {
      fireEvent.click(screen.getByText('Supprimer'));
    });

    // Exactly the chats the dialog named are deleted: both of them, never just '7'.
    await waitFor(() => expect(mocks.markDeleted).toHaveBeenCalledTimes(2));

    const deletedIds = mocks.markDeleted.mock.calls.map((call) => call[0]).sort();

    expect(deletedIds).toEqual(['7', '8']);
  });
});
