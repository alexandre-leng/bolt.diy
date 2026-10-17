import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpeechRecognitionButton } from './SpeechRecognition';

/*
 * Firefox has no Web Speech API: the mic used to stay enabled and do nothing (audit U9).
 */
describe('SpeechRecognitionButton', () => {
  it('is disabled with a French reason when the browser cannot dictate', () => {
    render(
      <SpeechRecognitionButton
        isListening={false}
        onStart={vi.fn()}
        onStop={vi.fn()}
        disabled={false}
        supported={false}
      />,
    );

    const button = screen.getByRole('button', { name: 'Dictée non disponible sur ce navigateur' });
    expect(button).toBeDisabled();
  });

  it('is enabled, with a French name, where dictation exists', () => {
    render(<SpeechRecognitionButton isListening={false} onStart={vi.fn()} onStop={vi.fn()} disabled={false} />);

    expect(screen.getByRole('button', { name: 'Dicter un message' })).toBeEnabled();
  });
});
