import React from 'react';
import { IconButton } from '~/components/ui/IconButton';
import type { DictationEngine } from '~/lib/dictation';
import { classNames } from '~/utils/classNames';

/*
 * The mic button, and what it says.
 *
 * Three states the user must be able to tell apart without guessing: idle, recording, and
 * transcribing. The language is on a second, adjacent control: it used to be frozen at page
 * load, so a French UI silently dictated English and there was no way to change it.
 *
 * Both controls are real `<button>`s with an accessible name and a 44 px touch target, and the
 * status line is a live region so an error is announced, not just painted.
 */
export const SpeechRecognitionButton = ({
  isListening,
  isTranscribing = false,
  onStart,
  onStop,
  disabled,
  supported = true,
  engine,
}: {
  isListening: boolean;
  isTranscribing?: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;

  /** False without any usable engine: the button is disabled and says why. */
  supported?: boolean;

  engine?: DictationEngine | null;
}) => {
  const title = !supported
    ? 'Dictée non disponible sur ce navigateur'
    : isTranscribing
      ? 'Transcription en cours…'
      : isListening
        ? 'Arrêter la dictée'
        : engine === 'server'
          ? 'Dicter un message (transcription serveur)'
          : 'Dicter un message';

  const ariaLabel = !supported
    ? 'Dictée non disponible sur ce navigateur'
    : isTranscribing
      ? 'Transcription en cours'
      : isListening
        ? 'Arrêter la dictée'
        : 'Démarrer la dictée';

  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        title={title}
        aria-label={ariaLabel}
        aria-pressed={isListening}
        disabled={disabled || !supported || isTranscribing}
        className={classNames('transition-all', {
          'text-bolt-elements-item-contentAccent': isListening,
        })}
        onClick={isListening ? onStop : onStart}
      >
        {isTranscribing ? (
          <div className="i-ph:circle-notch-bold text-xl animate-spin" />
        ) : isListening ? (
          <div className="i-ph:microphone-slash text-xl" />
        ) : (
          <div className="i-ph:microphone text-xl" />
        )}
      </IconButton>

      {/*
       * No language chip here: the user asked for the composer to stay minimal. The language is
       * set in Settings > Voix, which writes the same stored value the hook reads, so a change
       * there applies to the next dictation without this control.
       */}
    </div>
  );
};

/**
 * The line under the composer that explains what dictation is doing.
 *
 * Rendered for every state a user cannot see otherwise: an upload in flight, a refusal, an
 * unsupported browser. `aria-live="polite"` so a screen reader gets it too. Nothing renders
 * when dictation is idle and healthy: the composer stays clean.
 */
export const DictationStatus = ({
  errorMessage,
  isListening,
  isTranscribing,
  languageLabel,
  onDismiss,
  onRetry,
}: {
  errorMessage: string | null;
  isListening: boolean;
  isTranscribing: boolean;
  languageLabel: string;
  onDismiss: () => void;
  onRetry: () => void;
}) => {
  if (!errorMessage && !isTranscribing && !isListening) {
    return null;
  }

  if (errorMessage) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-bolt-elements-textPrimary"
      >
        <span className="min-w-0">
          <span className="i-ph:warning-circle mr-1 inline-block align-text-bottom text-red-500" />
          {errorMessage}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive"
            onClick={onRetry}
          >
            Réessayer
          </button>
          <button
            type="button"
            aria-label="Fermer le message de dictée"
            className="rounded px-2 py-1 text-xs text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive"
            onClick={onDismiss}
          >
            Fermer
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-1 text-xs text-bolt-elements-textSecondary"
    >
      <span
        className={classNames('inline-block h-2 w-2 rounded-full', {
          'bg-red-500 animate-pulse': isListening,
          'bg-amber-500 animate-pulse': isTranscribing,
        })}
      />
      {isTranscribing
        ? 'Transcription de l’enregistrement…'
        : `Dictée en cours (${languageLabel}) — parlez, puis cliquez à nouveau pour transcrire.`}
    </div>
  );
};
