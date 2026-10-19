import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmationDialog } from './Dialog';

afterEach(cleanup);

it('closes a confirmation exactly once when Escape is pressed', async () => {
  const close = vi.fn();
  render(<ConfirmationDialog isOpen onClose={close} onConfirm={vi.fn()} title="Confirm" description="Test dialog" />);
  await screen.findByRole('dialog');
  await userEvent.setup().keyboard('{Escape}');
  expect(close).toHaveBeenCalledTimes(1);
});
