import React from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

export const SpeechRecognitionButton = ({
  isListening,
  onStart,
  onStop,
  disabled,
  supported = true,
}: {
  isListening: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;

  /** False without the Web Speech API (Firefox): disabled, and the title says why. */
  supported?: boolean;
}) => {
  const title = !supported
    ? 'Dictée non disponible sur ce navigateur'
    : isListening
      ? 'Arrêter la dictée'
      : 'Dicter un message';

  return (
    <IconButton
      title={title}
      disabled={disabled || !supported}
      className={classNames('transition-all', {
        'text-bolt-elements-item-contentAccent': isListening,
      })}
      onClick={isListening ? onStop : onStart}
    >
      {isListening ? <div className="i-ph:microphone-slash text-xl" /> : <div className="i-ph:microphone text-xl" />}
    </IconButton>
  );
};
