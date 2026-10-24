import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * History list item (audit U2, U3, U11, U12): renaming from the projects panel must keep
 * the panel open, accept French titles, save once, and every action must be named.
 */
const persistence = vi.hoisted(() => ({
  updateChatDescription: vi.fn(async () => undefined),
  renameChat: vi.fn(async () => undefined),
  getMessages: vi.fn(async () => undefined),
}));

vi.mock('~/lib/persistence', async () => {
  const { atom } = await import('nanostores');

  return {
    db: {} as IDBDatabase,
    prefetchChat: vi.fn(),
    chatId: atom<string | undefined>(undefined),
    description: atom<string | undefined>(undefined),
    getMessages: persistence.getMessages,
    updateChatDescription: persistence.updateChatDescription,
  };
});

vi.mock('~/lib/persistence/historySync', () => ({ renameChat: persistence.renameChat }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('~/lib/toastify', () => ({ toast: toastMock }));

import { HistoryItem } from './HistoryItem';
import { sidebarOpenStore } from '~/lib/stores/sidebar';

const item = { id: '42', urlId: 'mon-site', description: 'Mon site', messages: [], timestamp: '2026-10-17T10:00:00Z' };

function renderItem() {
  return render(
    <MemoryRouter>
      <HistoryItem item={item as never} exportChat={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />
    </MemoryRouter>,
  );
}

/**
 * Every debug run used to persist a real conversation that looked exactly like the user's own
 * work. The sidebar now labels it, so it can be told apart at a glance and ignored.
 */
function renderWithMessages(messages: unknown[]) {
  return render(
    <MemoryRouter>
      <HistoryItem
        item={{ ...item, messages } as never}
        exportChat={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    </MemoryRouter>,
  );
}

/** Rename button, found by its icon so the lookup does not depend on the fix under test. */
function renameButton(container: HTMLElement) {
  return container.querySelector('button[aria-label="Renommer"]') as HTMLButtonElement;
}

function saveCount() {
  return persistence.renameChat.mock.calls.length + persistence.updateChatDescription.mock.calls.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  sidebarOpenStore.set(true);
});

describe('HistoryItem rename from the panel (U2)', () => {
  it('keeps the panel open and shows the title field', () => {
    const { container } = renderItem();

    act(() => {
      fireEvent.click(renameButton(container));
    });

    // Before: the click bubbled to the link, which closed the panel under the new field.
    expect(sidebarOpenStore.get()).toBe(true);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

describe('HistoryItem rename submit (U3, U11)', () => {
  it('saves an accented French title once and closes the editor', async () => {
    const { container } = renderItem();

    act(() => {
      fireEvent.click(renameButton(container));
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Café de Noël – L’atelier' } });

    const save = container.querySelector('form button[type="submit"]') as HTMLButtonElement;

    // One real click: mousedown, then click (which submits the form).
    await act(async () => {
      fireEvent.mouseDown(save);
      fireEvent.click(save);
    });

    expect(toastMock.error).not.toHaveBeenCalled();
    expect(saveCount()).toBe(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('saves a plain title only once per click', async () => {
    const { container } = renderItem();

    act(() => {
      fireEvent.click(renameButton(container));
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nouveau titre' } });

    const save = container.querySelector('form button[type="submit"]') as HTMLButtonElement;

    await act(async () => {
      fireEvent.mouseDown(save);
      fireEvent.click(save);
    });

    expect(saveCount()).toBe(1);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('pushes the rename through renameChat (timestamp + server push)', async () => {
    const { container } = renderItem();

    act(() => {
      fireEvent.click(renameButton(container));
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pâtisserie' } });

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    expect(persistence.renameChat).toHaveBeenCalledWith(expect.anything(), '42', 'Pâtisserie');
  });
});

describe('HistoryItem accessible names (U12, U13)', () => {
  it('names every action button in French', () => {
    renderItem();

    for (const name of ['Exporter', 'Dupliquer', 'Renommer', 'Supprimer']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });
});

describe('HistoryItem: titres déjà enregistrés avec « [Model: …] [Provider: …] » (A-02)', () => {
  const legacy = {
    ...item,
    description: '[Model: beam-free] [Provider: OpenCodeGo] créer un site à 1 milliard',
  };

  function renderLegacy() {
    return render(
      <MemoryRouter>
        <HistoryItem item={legacy as never} exportChat={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>,
    );
  }

  it('affiche le titre nettoyé dans la ligne, sans rien réécrire', () => {
    renderLegacy();

    expect(screen.getByTestId('history-item-title').textContent).toBe('créer un site à 1 milliard');
    expect(document.body.textContent).not.toContain('[Model:');
    expect(saveCount()).toBe(0);
  });

  it('ouvre l’édition sur le titre nettoyé, et valider sans changement n’écrit rien', async () => {
    const { container } = renderLegacy();

    act(() => {
      fireEvent.click(renameButton(container));
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('créer un site à 1 milliard');

    await act(async () => {
      fireEvent.submit(input.closest('form') as HTMLFormElement);
    });

    expect(saveCount()).toBe(0);
  });
});

describe('HistoryItem debug marker', () => {
  it('labels a conversation created by a debug dispatcher', () => {
    renderWithMessages([
      { role: 'user', content: '[Model: deepseek-v4.1-flash] [Provider: OpenCodeGo] Construis une landing page' },
    ]);

    expect(screen.getByTestId('debug-badge').textContent).toBe('DEBUG');
  });

  it('labels a throwaway probe as a probe', () => {
    renderWithMessages([{ role: 'user', content: '[Model: x]\n\n[Provider: y]\n\nDis simplement: bonjour' }]);

    expect(screen.getByTestId('debug-badge').textContent).toBe('SONDE');
  });

  it('leaves a real conversation unlabelled', () => {
    renderWithMessages([
      {
        role: 'user',
        content: '[Model: x]\n\n[Provider: y]\n\nConstruis une landing page pour une boulangerie artisanale',
      },
    ]);

    expect(screen.queryByTestId('debug-badge')).toBeNull();
  });
});
