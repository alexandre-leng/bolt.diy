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
    render(<ConnectionForm {...baseProps} tokenLabel="Access Token" />);

    expect(screen.getByLabelText('Access Token')).toBeInstanceOf(HTMLInputElement);
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

    const select = screen.getByLabelText('Token Type');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAccessibleDescription('Full access');
  });

  it('announces an error with role alert and links it to the input', () => {
    render(<ConnectionForm {...baseProps} error="Invalid token" />);

    const input = screen.getByLabelText('Access Token');
    const alert = screen.getByRole('alert');

    expect(alert).toHaveTextContent('Invalid token');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Invalid token'));
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('does not mark the input invalid or render an alert without an error', () => {
    render(<ConnectionForm {...baseProps} />);

    const input = screen.getByLabelText('Access Token');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the token help link described by the input', () => {
    render(<ConnectionForm {...baseProps} />);

    const link = screen.getByRole('link', { name: /get your token/i });
    expect(link).toHaveAttribute('href', 'https://example.com/token');
    expect(screen.getByLabelText('Access Token').getAttribute('aria-describedby')).toContain(link.closest('div')!.id);
  });

  it('keeps the submit control reachable by name', () => {
    const onConnect = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<ConnectionForm {...baseProps} onConnect={onConnect} />);

    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
