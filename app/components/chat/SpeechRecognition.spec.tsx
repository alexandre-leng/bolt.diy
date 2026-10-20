import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DictationStatus, SpeechRecognitionButton } from './SpeechRecognition';

/*
 * Dictation used to fail in complete silence: Firefox showed a disabled mic with no
 * alternative, and a refused microphone or a failed upload turned the button dark with
 * nothing said. These cases pin the three states apart and prove the message is rendered.
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

    expect(screen.getByRole('button', { name: 'Démarrer la dictée' })).toBeEnabled();
  });

  it('names the server engine, so the user knows the audio is uploaded', () => {
    render(
      <SpeechRecognitionButton
        isListening={false}
        onStart={vi.fn()}
        onStop={vi.fn()}
        disabled={false}
        engine="server"
      />,
    );

    expect(screen.getByTitle('Dicter un message (transcription serveur)')).toBeEnabled();
  });

  it('says it is transcribing and refuses a second click instead of losing the clip', () => {
    const onStart = vi.fn();

    render(
      <SpeechRecognitionButton
        isListening={false}
        isTranscribing
        onStart={onStart}
        onStop={vi.fn()}
        disabled={false}
        engine="server"
      />,
    );

    const button = screen.getByRole('button', { name: 'Transcription en cours' });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('keeps the composer free of a language control: the language lives in Settings > Voix', () => {
    /*
     * The chip was added here, then removed at the user's request to keep the composer minimal.
     * The setting it used to change is still there, one place: the Voice settings tab writes the
     * same stored value the dictation hook reads.
     */
    render(<SpeechRecognitionButton isListening={false} onStart={vi.fn()} onStop={vi.fn()} disabled={false} />);

    expect(screen.queryByRole('button', { name: /langue de dictée/i })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('DictationStatus', () => {
  it('renders nothing when dictation is idle and healthy', () => {
    const { container } = render(
      <DictationStatus
        errorMessage={null}
        isListening={false}
        isTranscribing={false}
        languageLabel="Français (France)"
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a refused microphone as an actionable message, and can retry', () => {
    const onRetry = vi.fn();

    render(
      <DictationStatus
        errorMessage="Micro refusé. Autorisez le microphone dans les réglages du navigateur pour ce site, puis réessayez."
        isListening={false}
        isTranscribing={false}
        languageLabel="Français (France)"
        onDismiss={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/Micro refusé/);

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('announces a transcription in progress', () => {
    render(
      <DictationStatus
        errorMessage={null}
        isListening={false}
        isTranscribing
        languageLabel="Français (France)"
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/Transcription de l’enregistrement/);
  });

  it('says which language is listening while recording', () => {
    render(
      <DictationStatus
        errorMessage={null}
        isListening
        isTranscribing={false}
        languageLabel="Français (France)"
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Dictée en cours (Français (France))');
  });
});
