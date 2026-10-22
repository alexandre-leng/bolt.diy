import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsHeader } from './SettingsHeader';

/*
 * Regression for the overlap reported on a phone: the panel drew a lone "Retour au projet"
 * button under the app header (logo + toggle), painted above it, so the wordmark covered the
 * button. The bar is now the single owner of that band: a title, one back control whose target
 * follows the view, and one close control.
 */
describe('SettingsHeader', () => {
  it('walks back to the category list from a section, and closes from the list', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(<SettingsHeader showingSection onBack={onBack} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retour à tous les réglages' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender(<SettingsHeader showingSection={false} onBack={onBack} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retour au projet' }));
    expect(onBack).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Fermer les réglages' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names the panel even when no leaf is open', () => {
    render(<SettingsHeader showingSection={false} onBack={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId('settings-title').textContent).toBe('Réglages');
  });

  it('shows the leaf title, truncated so a long label cannot push the close button out', () => {
    render(<SettingsHeader title="Connecteurs" showingSection onBack={vi.fn()} onClose={vi.fn()} />);

    const title = screen.getByTestId('settings-title');
    expect(title.textContent).toBe('Connecteurs');
    expect(title.className).toContain('truncate');
    expect(title.className).toContain('min-w-0');
  });

  it('gives both controls a 44px target', () => {
    render(<SettingsHeader showingSection={false} onBack={vi.fn()} onClose={vi.fn()} />);

    for (const button of [screen.getByTestId('settings-back'), screen.getByTestId('settings-close')]) {
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-11');
    }
  });
});
