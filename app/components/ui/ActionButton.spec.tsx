import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionButton } from './ActionButton';

/*
 * Regression for the grey blocks measured on the live Voice tab: a button that only sets a
 * border and a text colour inherits the UA background (rgb(239,239,239)) and looks disabled on
 * the dark theme. Both tones must paint their own surface.
 */
describe('ActionButton', () => {
  it('sets its own surface, never the UA one', () => {
    render(<ActionButton>Tester la transcription</ActionButton>);

    const button = screen.getByRole('button', { name: 'Tester la transcription' });
    expect(button.className).toContain('bg-bolt-elements-background-depth-2');
  });

  it('uses the accent surface for the primary tone', () => {
    render(<ActionButton tone="primary">Enregistrer</ActionButton>);

    const button = screen.getByRole('button', { name: 'Enregistrer' });
    expect(button.className).toContain('bg-bolt-elements-button-primary-background');
    expect(button.className).not.toContain('bg-bolt-elements-background-depth-2');
  });

  it('keeps a 44px target and a keyboard focus ring', () => {
    render(<ActionButton>Arrêter</ActionButton>);

    const button = screen.getByRole('button', { name: 'Arrêter' });
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('focus-visible:ring-accent-500');
  });

  it('is a submit-safe button by default and forwards native props', () => {
    render(
      <ActionButton disabled aria-label="Afficher la clé OpenAI">
        eye
      </ActionButton>,
    );

    const button = screen.getByRole('button', { name: 'Afficher la clé OpenAI' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button).toBeDisabled();
  });
});
