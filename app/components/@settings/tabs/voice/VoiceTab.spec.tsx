import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceTab from './VoiceTab';

/*
 * Measured on the live build, the Voice tab had four visible defects:
 * - four dropdowns kept the platform chrome (`appearance: auto`) inside a themed form;
 * - "Tester la transcription" and the two eye buttons inherited the UA button background
 *   (rgb(239,239,239)), so they read as disabled grey blocks on the dark theme;
 * - an inline label was immediately followed by a block description, so the two sentences ran
 *   together ("Afficher le bouton microLe masquer libère la place...");
 * - the fallback explainer was printed twice, once under a switch and once under the card title.
 */
vi.mock('~/components/chat/APIKeyManager', () => ({
  getApiKeysFromCookies: () => ({}),
}));

describe('VoiceTab', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('draws every dropdown as a themed field, not a native one', () => {
    render(<VoiceTab />);

    for (const name of [
      'Langue de dictée',
      'Service de transcription',
      'Modèle',
      'Voix (aucune détectée pour l’instant)',
    ]) {
      const field = screen.queryByRole('combobox', { name }) ?? screen.getByLabelText(name, { selector: 'select' });
      expect(field.className).toContain('appearance-none');
    }
  });

  it('gives the test button its own surface instead of the UA grey', () => {
    render(<VoiceTab />);

    const test = screen.getByRole('button', { name: /Tester la transcription/ });
    expect(test.className).toContain('bg-bolt-elements-background-depth-2');
  });

  it('labels each switch and links its description', () => {
    render(<VoiceTab />);

    const mic = screen.getByRole('switch', { name: 'Afficher le bouton micro' });
    const describedBy = mic.getAttribute('aria-describedby');
    expect(describedBy).toBe('dictation-show-mic-description');
    expect(document.getElementById(describedBy as string)?.textContent).toContain('libère la place');

    // The label is a real <label for>, not a text node glued to the description.
    expect(screen.getByText('Afficher le bouton micro').tagName).toBe('LABEL');
  });

  it('keeps the fallback explanation once', () => {
    render(<VoiceTab />);

    const occurrences = (document.body.textContent?.match(/reconnaissance vocale \(Firefox, Safari/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('cannot remove a stored key by saving an empty field', () => {
    render(<VoiceTab />);

    const saveButtons = screen.getAllByRole('button', { name: 'Enregistrer' });
    expect(saveButtons).toHaveLength(2);

    for (const button of saveButtons) {
      expect(button).toBeDisabled();
    }

    fireEvent.change(screen.getByLabelText('Clé API OpenAI'), { target: { value: 'sk-test' } });
    expect(saveButtons[0]).toBeEnabled();
  });
});
