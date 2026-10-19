import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestartPreviewButton } from './RestartPreviewButton';

vi.mock('~/lib/toastify', () => ({ toast: { error: vi.fn() } }));
import { toast } from '~/lib/toastify';

afterEach(cleanup);

describe('RestartPreviewButton', () => {
  it('launches the server restart and prevents another click until it completes', async () => {
    let finish!: () => void;

    const onRestart = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<RestartPreviewButton onRestart={onRestart} />);

    const button = screen.getByRole('button', { name: 'Relancer le serveur de prévisualisation' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it('reports a failed restart and lets the user retry', async () => {
    render(<RestartPreviewButton onRestart={vi.fn().mockRejectedValue(new Error('Port occupé'))} />);

    const button = screen.getByRole('button', { name: 'Relancer le serveur de prévisualisation' });
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Port occupé'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
