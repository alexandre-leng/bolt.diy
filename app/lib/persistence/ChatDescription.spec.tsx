import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Header title editor (audit U3, U11, U15).
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
    chatId: atom<string | undefined>('chat-1'),
    description: atom<string | undefined>('Mon site'),
    getMessages: persistence.getMessages,
    updateChatDescription: persistence.updateChatDescription,
  };
});

vi.mock('~/lib/persistence/historySync', () => ({ renameChat: persistence.renameChat }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('~/lib/toastify', () => ({ toast: toastMock }));

import { ChatDescription } from './ChatDescription.client';
import { description } from '~/lib/persistence';

function saveCount() {
  return persistence.renameChat.mock.calls.length + persistence.updateChatDescription.mock.calls.length;
}

function openEditor(container: HTMLElement, value: string) {
  act(() => {
    fireEvent.click(screen.getByTestId('rename-chat'));
  });

  fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value } });

  return container.querySelector('form button[type="submit"]') as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  description.set('Mon site');
});

describe('ChatDescription', () => {
  it('saves once per click on the check and closes the editor (U11)', async () => {
    const { container } = render(<ChatDescription />);
    const save = openEditor(container, 'Nouveau titre');

    await act(async () => {
      fireEvent.mouseDown(save);
      fireEvent.click(save);
    });

    // Before: mousedown AND the form submit each saved, and each toggled the editor.
    expect(saveCount()).toBe(1);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input')).toBeNull();
    expect(description.get()).toBe('Nouveau titre');
  });

  it('accepts an accented title (U3)', async () => {
    const { container } = render(<ChatDescription />);
    const save = openEditor(container, 'Site pâtisserie de Noël');

    await act(async () => {
      fireEvent.click(save);
    });

    expect(toastMock.error).not.toHaveBeenCalled();
    expect(saveCount()).toBe(1);
  });

  it('keeps a long title input within its container so the check stays reachable (U15)', () => {
    const { container } = render(<ChatDescription />);
    openEditor(container, 'x'.repeat(80));

    const input = container.querySelector('input') as HTMLInputElement;

    // Width grows with the text, but is capped by the container instead of overflowing it.
    expect(input.style.maxWidth).toBe('100%');
    expect(input.className).toContain('min-w-0');
  });
});

describe('ChatDescription: titre hérité « [Model: …] [Provider: …] » (A-02)', () => {
  it('affiche le titre nettoyé dans l’en-tête sans écrire côté serveur', () => {
    description.set('[Model: beam-free] [Provider: OpenCodeGo] créer un site à 1 milliard');

    render(<ChatDescription />);

    expect(screen.getByTestId('chat-description-title').textContent).toBe('créer un site à 1 milliard');
    expect(saveCount()).toBe(0);
  });

  it('garde le bouton Renommer dans la ligne du titre (A 768 px : min-w-0, titre tronqué)', () => {
    description.set('Un titre très long '.repeat(10));

    render(<ChatDescription />);

    const row = screen.getByTestId('chat-description');
    const title = screen.getByTestId('chat-description-title');

    // jsdom has no layout: pin the classes that let the row shrink and the title truncate.
    expect(row.className).toMatch(/\bmin-w-0\b/);
    expect(row.className).toMatch(/\bmax-w-full\b/);
    expect(title.className).toMatch(/\bmin-w-0\b/);
    expect(title.className).toMatch(/\btruncate\b/);
    expect(row.contains(screen.getByTestId('rename-chat'))).toBe(true);
  });
});
