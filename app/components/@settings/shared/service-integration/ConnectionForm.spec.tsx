import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionForm } from './ConnectionForm';

const baseProps = {
  isConnected: false,
  isConnecting: false,
  token: 'abc',
  onTokenChange: vi.fn(),
  onConnect: vi.fn((e: React.FormEvent) => e.preventDefault()),
  onDisconnect: vi.fn(),
  serviceName: 'GitHub',
  getTokenUrl: 'https://example.com/token',
};

describe('ConnectionForm accessibility', () => {
  it('associates the token label with the input', () => {
    render(<ConnectionForm {...baseProps} tokenLabel="Jeton d’accès" />);

    expect(screen.getByLabelText('Jeton d’accès')).toBeInstanceOf(HTMLInputElement);
  });

  it('associates the token type select with its label', () => {
    render(
      <ConnectionForm
        {...baseProps}
        tokenTypes={[
          { value: 'classic', label: 'Classic', description: 'Full access' },
          { value: 'fine', label: 'Fine-grained' },
        ]}
        selectedTokenType="classic"
        onTokenTypeChange={vi.fn()}
      />,
    );

    const select = screen.getByLabelText('Type de jeton');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAccessibleDescription('Full access');
  });

  it('announces an error with role alert and links it to the input', () => {
    render(<ConnectionForm {...baseProps} error="Invalid token" />);

    const input = screen.getByLabelText('Jeton d’accès');
    const alert = screen.getByRole('alert');

    expect(alert).toHaveTextContent('Invalid token');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Invalid token'));
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('does not mark the input invalid or render an alert without an error', () => {
    render(<ConnectionForm {...baseProps} />);

    const input = screen.getByLabelText('Jeton d’accès');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the token help link described by the input', () => {
    render(<ConnectionForm {...baseProps} />);

    const link = screen.getByRole('link', { name: /obtenir votre jeton/i });
    expect(link).toHaveAttribute('href', 'https://example.com/token');
    expect(screen.getByLabelText('Jeton d’accès').getAttribute('aria-describedby')).toContain(link.closest('div')!.id);
  });

  it('reveals and masks the token without submitting or breaking its error association', () => {
    const onConnect = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onTokenChange = vi.fn();
    render(<ConnectionForm {...baseProps} onConnect={onConnect} onTokenChange={onTokenChange} error="Invalid token" />);

    const input = screen.getByLabelText('Access Token');
    const originalDescription = input.getAttribute('aria-describedby');
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Afficher le jeton' });
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('abc');
    expect(input).toHaveAttribute('aria-describedby', originalDescription);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Invalid token'));
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Masquer le jeton' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(onConnect).not.toHaveBeenCalled();
    expect(onTokenChange).not.toHaveBeenCalled();
  });

  it('disables the reveal control while connecting', () => {
    render(<ConnectionForm {...baseProps} isConnecting />);
    expect(screen.getByLabelText('Access Token')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Afficher le jeton' })).toBeDisabled();
  });

  it('keeps the submit control reachable by name', () => {
    const onConnect = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<ConnectionForm {...baseProps} onConnect={onConnect} />);

    fireEvent.click(screen.getByRole('button', { name: /^connecter$/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
