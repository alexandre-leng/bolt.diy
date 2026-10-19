import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { atom } from 'nanostores';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: the preview must not go permanently blank when the selected port closes.
 *
 * `activePreview = previews[activePreviewIndex]`. The only code that re-selected the index
 * ran while `previews.length > 1` and only until the user first picked a port
 * (`hasSelectedPreview.current`). Once the user picked a port and that port closed, the
 * index pointed past the end of the array and every render below saw `activePreview`
 * undefined — "No preview available" forever. An unconditional clamp on `previews` fixes it.
 */
const previewsAtom = atom<Array<{ port: number; baseUrl: string }>>([]);

vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    get previews() {
      return previewsAtom;
    },
  },
}));

vi.mock('~/lib/stores/qrCodeStore', () => ({ expoUrlAtom: atom<string | undefined>(undefined) }));

vi.mock('~/components/workbench/InspectorPanel', () => ({ InspectorPanel: () => null }));

import { Preview } from './Preview';

function setPreviews(previews: Array<{ port: number; baseUrl: string }>) {
  act(() => {
    previewsAtom.set(previews);
  });
}

beforeEach(() => {
  previewsAtom.set([]);
});

describe('Preview active port clamp', () => {
  it('falls back to a live preview when the selected port closes', async () => {
    const { rerender } = render(<Preview />);

    // The latest announced port is auto-selected; explicitly pick the other one below.
    setPreviews([
      { port: 5173, baseUrl: 'https://5173--preview.localhost' },
      { port: 3000, baseUrl: 'https://3000--preview.localhost' },
    ]);
    rerender(<Preview />);

    await waitFor(() => {
      const frames = screen.getAllByTitle('preview') as HTMLIFrameElement[];
      expect(frames.some((frame) => frame.getAttribute('src') === 'https://3000--preview.localhost')).toBe(true);
    });

    // The user opens the second port through the dropdown.
    act(() => {
      const dropdown = document.querySelector('.z-port-dropdown') as HTMLElement;
      fireEvent.click(dropdown.querySelector('button') as HTMLButtonElement);
    });
    act(() => {
      fireEvent.click(screen.getByText('5173'));
    });
    rerender(<Preview />);

    await waitFor(() => {
      const frames = screen.getAllByTitle('preview') as HTMLIFrameElement[];
      expect(frames.some((frame) => frame.getAttribute('src') === 'https://5173--preview.localhost')).toBe(true);
    });

    // That port closes; only the first remains, so the selected index is now out of range.
    setPreviews([{ port: 3000, baseUrl: 'https://3000--preview.localhost' }]);
    rerender(<Preview />);

    // The preview must show a real port, not "No preview available".
    await waitFor(() => {
      expect(screen.queryByText('No preview available')).toBeNull();
    });

    const frames = screen.getAllByTitle('preview') as HTMLIFrameElement[];
    expect(frames.some((frame) => frame.getAttribute('src') === 'https://3000--preview.localhost')).toBe(true);
  });

  it('reloads the preview through state, so the controlled src is not discarded', async () => {
    const { rerender } = render(<Preview />);

    setPreviews([{ port: 3000, baseUrl: 'https://3000--preview.localhost' }]);
    rerender(<Preview />);

    await waitFor(() => {
      const frames = screen.getAllByTitle('preview') as HTMLIFrameElement[];
      expect(frames.some((frame) => frame.getAttribute('src') === 'https://3000--preview.localhost')).toBe(true);
    });

    const before = screen.getAllByTitle('preview')[0] as HTMLIFrameElement;

    /*
     * The old reload wrote `iframeRef.current.src = iframeRef.current.src` directly on the
     * DOM node. Because `src={iframeUrl}` is a controlled prop, React discarded that on the
     * next render — a route the user typed into the preview was lost, and the element kept
     * the same identity. A state-driven reload remounts the iframe, so the node changes while
     * the controlled `src` stays correct.
     */
    act(() => {
      fireEvent.click(screen.getByLabelText('Recharger l’aperçu'));
    });

    const after = screen.getAllByTitle('preview')[0] as HTMLIFrameElement;

    expect(after).not.toBe(before);
    expect(after.getAttribute('src')).toBe('https://3000--preview.localhost');
    expect(
      (before as unknown as { src?: string }).src === 'https://3000--preview.localhost' || before.isConnected === false,
    ).toBe(true);
  });
});
