import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { atom } from 'nanostores';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One preview button: the reload in the preview header and the server restart that used to live in
 * the terminal header are merged. The reload must always run (it is the reason the button exists)
 * and the server restart must be attempted on top of it, without breaking the reload when it fails.
 */
const previewsAtom = atom<Array<{ port: number; baseUrl: string }>>([]);
const restartProjectPreview = vi.fn();

vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    get previews() {
      return previewsAtom;
    },
  },
}));

vi.mock('~/lib/stores/qrCodeStore', () => ({ expoUrlAtom: atom<string | undefined>(undefined) }));
vi.mock('~/components/workbench/InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('~/lib/runtime/projectMcp', () => ({ restartProjectPreview: () => restartProjectPreview() }));
vi.mock('~/lib/toastify', () => ({ toast: { error: vi.fn() } }));

import { Preview } from './Preview';
import { toast } from '~/lib/toastify';

beforeEach(() => {
  previewsAtom.set([{ port: 3000, baseUrl: 'https://3000--preview.localhost' }]);
  restartProjectPreview.mockReset();
  restartProjectPreview.mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
});

describe('Preview merged reload + restart control', () => {
  it('relaunches the preview server from the same button that reloads the preview', async () => {
    render(<Preview />);

    await waitFor(() => expect(screen.getAllByTitle('Aperçu du projet').length).toBeGreaterThan(0));

    act(() => {
      fireEvent.click(screen.getByLabelText('Recharger l’aperçu et relancer le serveur'));
    });

    await waitFor(() => expect(restartProjectPreview).toHaveBeenCalledTimes(1));
  });

  it('still remounts the iframe when the server restart fails, and reports the failure', async () => {
    const { rerender } = render(<Preview />);

    await waitFor(() => expect(screen.getAllByTitle('Aperçu du projet').length).toBeGreaterThan(0));

    const before = screen.getAllByTitle('Aperçu du projet')[0] as HTMLIFrameElement;

    restartProjectPreview.mockRejectedValue(new Error('Port occupé'));

    act(() => {
      fireEvent.click(screen.getByLabelText('Recharger l’aperçu et relancer le serveur'));
    });

    rerender(<Preview />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Port occupé'));

    const after = screen.getAllByTitle('Aperçu du projet')[0] as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.getAttribute('src')).toBe('https://3000--preview.localhost');
  });

  it('exposes exactly one reload control, with no separate restart button left behind', async () => {
    render(<Preview />);

    await waitFor(() => expect(screen.getAllByTitle('Aperçu du projet').length).toBeGreaterThan(0));

    expect(screen.queryByRole('button', { name: 'Relancer le serveur de prévisualisation' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Recharger l’aperçu et relancer le serveur' })).toHaveLength(1);
  });
});
