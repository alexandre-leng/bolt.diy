import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./ScreenshotToCode', () => ({ ScreenshotToCode: () => <div>generator</div> }));

import { ScreenshotDialog } from './ChatBox';

function Harness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open-screenshot
      </button>
      <ScreenshotDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

describe('ScreenshotDialog (accessible Radix dialog)', () => {
  it('exposes a named modal dialog, focuses inside it, and closes on Escape', async () => {
    render(<Harness />);

    const trigger = screen.getByText('open-screenshot');
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Depuis une capture d’écran' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('generator')).toBeTruthy();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('restores focus to the trigger when closed with the close button', async () => {
    render(<Harness />);

    const trigger = screen.getByText('open-screenshot');
    trigger.focus();
    fireEvent.click(trigger);

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le générateur de capture' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
