import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Dictation for the composer (Web Speech API).
 *
 * Lifted out of BaseChat, where it had three user-visible faults:
 * - Firefox (desktop and Android) has no SpeechRecognition, yet the mic button stayed
 *   enabled and silently did nothing. `supported` lets the button say why it is disabled.
 * - No `onend` handler: when Chrome stopped on its own after a silence, `isListening`
 *   stayed true and the button kept offering "stop".
 * - No `lang`: the browser fell back to the page language (then `en`), so French dictation
 *   was transcribed as English. And each result REPLACED the text already typed.
 */

/** Language for recognition: the browser's own locale, French by default. */
export function speechLanguage(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }

  return 'fr-FR';
}

/** Append dictated text to what was typed before listening started. */
export function joinTranscript(base: string, transcript: string): string {
  if (!base) {
    return transcript;
  }

  if (!transcript) {
    return base;
  }

  return /\s$/.test(base) ? `${base}${transcript}` : `${base} ${transcript}`;
}

interface UseSpeechRecognitionOptions {
  /** Current composer text, captured when listening starts so dictation appends to it. */
  input: string;

  /** Receives the full composer text (typed prefix + dictation so far). */
  onTranscript: (text: string) => void;
}

export function useSpeechRecognition({ input, onTranscript }: UseSpeechRecognitionOptions) {
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);

  const inputRef = useRef(input);
  inputRef.current = input;

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Text present when listening started; every result is appended to it, never replaces it.
  const baseRef = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const speechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!speechRecognitionClass) {
      return undefined;
    }

    const instance = new speechRecognitionClass();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = speechLanguage();

    instance.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0])
        .map((result) => result.transcript)
        .join('');

      onTranscriptRef.current(joinTranscript(baseRef.current, transcript));
    };

    instance.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    // The engine stops by itself (silence, network, permission): reflect it in the button.
    instance.onend = () => setIsListening(false);

    setRecognition(instance);

    return () => {
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;

      try {
        instance.abort();
      } catch {
        // Never started: nothing to abort.
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recognition) {
      return;
    }

    baseRef.current = inputRef.current;

    try {
      recognition.start();
      setIsListening(true);
    } catch (error) {
      // start() throws if it is already running; the button must not claim a state it is not in.
      console.error('Speech recognition could not start:', error);
    }
  }, [recognition]);

  const stopListening = useCallback(() => {
    if (!recognition) {
      return;
    }

    recognition.stop();
    setIsListening(false);
  }, [recognition]);

  const abortListening = useCallback(() => {
    if (!recognition) {
      return;
    }

    recognition.abort();
    baseRef.current = '';
    setIsListening(false);
  }, [recognition]);

  return { supported: recognition !== null, isListening, startListening, stopListening, abortListening };
}
