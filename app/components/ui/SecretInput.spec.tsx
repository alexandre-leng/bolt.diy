import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SecretInput } from './SecretInput';

function CredentialForm({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="credential">Jeton</label>
      <SecretInput id="credential" value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="submit">Connecter</button>
    </form>
  );
}

describe('SecretInput', () => {
  it('starts masked and toggles without submitting, losing the value, or replacing the field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CredentialForm onSubmit={onSubmit} />);

    const input = screen.getByLabelText('Jeton');
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, 'test-token');

    const toggle = screen.getByRole('button', { name: 'Afficher le jeton' });
    expect(toggle).toHaveAttribute('aria-controls', 'credential');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass('min-w-11', 'min-h-11', 'focus-visible:ring-2');
    await user.click(toggle);
    expect(screen.getByLabelText('Jeton')).toBe(input);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('test-token');
    expect(toggle).toHaveAccessibleName('Masquer le jeton');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('test-token');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Connecter' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('supports Tab, Space and Enter with native button keyboard behavior', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CredentialForm onSubmit={onSubmit} />);
    await user.tab();
    expect(screen.getByLabelText('Jeton')).toHaveFocus();
    await user.tab();

    const toggle = screen.getByRole('button', { name: 'Afficher le jeton' });
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByLabelText('Jeton')).toHaveAttribute('type', 'text');
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Jeton')).toHaveAttribute('type', 'password');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables both controls and masks the field while disabled', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SecretInput aria-label="Jeton" defaultValue="test-token" />);
    await user.click(screen.getByRole('button', { name: 'Afficher le jeton' }));
    rerender(<SecretInput aria-label="Jeton" defaultValue="test-token" disabled />);

    const input = screen.getByLabelText('Jeton');
    const toggle = screen.getByRole('button', { name: 'Afficher le jeton' });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(input).toHaveValue('test-token');
  });

  it('preserves label, error description, autocomplete and validation after revealing', async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="token">Jeton</label>
        <SecretInput id="token" aria-invalid="true" aria-describedby="token-error" autoComplete="off" required />
        <p id="token-error" role="alert">
          Jeton invalide
        </p>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Afficher le jeton' }));

    const input = screen.getByLabelText('Jeton');
    expect(input).toHaveAttribute('id', 'token');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Jeton invalide');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toBeRequired();
    expect(screen.getByRole('alert')).toHaveTextContent('Jeton invalide');
  });
});
