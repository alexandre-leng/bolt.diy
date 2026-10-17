import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

/*
 * Icon-only buttons were announced as a bare "button" and showed no focus ring (audit U12).
 */
describe('IconButton', () => {
  it('uses its title as the accessible name', () => {
    render(<IconButton icon="i-ph:arrow-clockwise" title="Recharger l’aperçu" />);

    expect(screen.getByRole('button', { name: 'Recharger l’aperçu' })).toBeTruthy();
  });

  it('lets an explicit aria-label win over the title', () => {
    render(<IconButton icon="i-ph:x" title="Fermer" aria-label="Fermer l’atelier" />);

    expect(screen.getByRole('button', { name: 'Fermer l’atelier' })).toBeTruthy();
  });

  it('shows a focus ring for keyboard users', () => {
    render(<IconButton icon="i-ph:x" title="Fermer" />);

    expect(screen.getByRole('button').className).toContain('focus-visible:outline-accent-500');
  });

  it('forwards data-testid and still clicks', () => {
    const onClick = vi.fn();
    render(<IconButton icon="i-ph:gear" title="Réglages" data-testid="settings-button" onClick={onClick} />);

    fireEvent.click(screen.getByTestId('settings-button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
