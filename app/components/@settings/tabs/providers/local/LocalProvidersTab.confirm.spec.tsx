import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stable references, like the real store: a fresh object per render would refetch the models forever.
const settingsMock = vi.hoisted(() => ({
  providers: {
    Ollama: {
      name: 'Ollama',
      settings: { enabled: true, baseUrl: 'http://127.0.0.1:11434' },
      staticModels: [],
    },
  },
  updateProviderSettings: () => undefined,
}));

const healthMock = vi.hoisted(() => ({ startMonitoring: () => undefined, stopMonitoring: () => undefined }));

vi.mock('~/lib/hooks/useSettings', () => ({ useSettings: () => settingsMock }));

vi.mock('~/lib/hooks/useLocalModelHealth', () => ({ useLocalModelHealth: () => healthMock }));

import LocalProvidersTab from './LocalProvidersTab';

const fetchMock = vi.fn();

let nativeConfirm: ReturnType<typeof vi.spyOn>;

function deleteCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/delete'));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(
        JSON.stringify({
          models: [{ name: 'llama3:8b', size: 1, digest: 'abc', modified_at: '', details: {} }],
        }),
        { status: 200 },
      );
    }

    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  nativeConfirm = vi.spyOn(window, 'confirm').mockImplementation(() => true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openDeleteConfirmation() {
  render(<LocalProvidersTab />);

  const deleteButton = await screen.findByRole('button', { name: /supprimer/i });
  deleteButton.focus();
  fireEvent.click(deleteButton);

  return deleteButton;
}

describe('LocalProvidersTab: suppression d’un modèle Ollama', () => {
  it('demande confirmation dans la boîte de l’app, pas via la boîte native du navigateur', async () => {
    await openDeleteConfirmation();

    expect(await screen.findByRole('dialog', { name: 'Supprimer le modèle llama3:8b ?' })).toBeTruthy();
    expect(nativeConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' })));
    expect(deleteCalls()).toHaveLength(0);
  });

  it('ne supprime qu’après un clic sur « Supprimer le modèle »', async () => {
    await openDeleteConfirmation();

    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer le modèle' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(JSON.parse(String(deleteCalls()[0][1]?.body))).toEqual({ name: 'llama3:8b' });
  });

  it('Échap annule: aucune suppression et focus rendu au bouton', async () => {
    const deleteButton = await openDeleteConfirmation();

    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(deleteButton));
    expect(deleteCalls()).toHaveLength(0);
  });
});
