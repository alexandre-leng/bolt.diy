import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/components/header/ReportBugPanel', () => ({ ReportBugPanel: () => null }));

import { HeaderActionButtons } from './HeaderActionButtons.client';
import { MobilePreviewButton } from './MobilePreviewButton.client';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * Header actions (audit U7, U13).
 */
afterEach(() => {
  workbenchStore.previews.set([]);
  (workbenchStore.artifacts as any).set({});
  workbenchStore.showWorkbench.set(false);
});

describe('HeaderActionButtons', () => {
  it('offers Publish before the preview has started (U7)', () => {
    workbenchStore.previews.set([]);
    (workbenchStore.artifacts as any).set({
      'project-x': { id: 'project-x', title: 'Mon site', closed: true, type: 'bundled', runner: undefined },
    });

    render(<HeaderActionButtons chatStarted />);

    // Before: hidden until previews[0] existed — i.e. never when the preview failed to boot.
    expect(screen.getByTestId('publish-button')).toBeEnabled();
  });

  it('labels Report Bug in French (U13)', () => {
    workbenchStore.previews.set([{ port: 5173, ready: true, baseUrl: 'http://localhost:5173' }] as never);

    render(<HeaderActionButtons chatStarted />);

    expect(screen.getByRole('button', { name: 'Signaler un bug' })).toBeTruthy();
    expect(screen.queryByText('Report Bug')).toBeNull();
  });
});

describe('MobilePreviewButton (U13)', () => {
  it('is labelled in French', () => {
    render(<MobilePreviewButton />);

    expect(screen.getByTestId('mobile-preview-button').textContent).toContain('Aperçu');
    expect(screen.getByRole('button', { name: 'Ouvrir l’aperçu' })).toBeTruthy();
  });
});
