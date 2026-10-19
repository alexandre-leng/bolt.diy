import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DICTATION_SETTINGS,
  DICTATION_STORAGE_KEY,
  MAX_DICTATION_MS,
  MIN_CLIP_MS,
  type DictationEngine,
  type DictationError,
  type DictationSettings,
  boundTranscript,
  describeDictationError,
  mapSpeechError,
  mapTranscribeFailure,
  parseDictationSettings,
  pickEngine,
  pickRecordingMimeType,
  recordingExtension,
} from '~/lib/dictation';

/*
 * Dictation for the composer, with two engines and one contract.
 *
 * Engine 1, Web Speech API (Chromium): no upload, instant interim results, but the audio
 * goes to Google, and it exists nowhere else.
 * Engine 2, server transcription (`/api/transcribe`): records with MediaRecorder and uploads,
 * so Firefox, Safari, iOS and Brave get dictation too.
 *
 * The hook keeps one state machine for both and reports every failure as a code the UI turns
 * into a sentence. Faults fixed here, each of which used to be silent:
 * - no engine at all: the button was disabled with no alternative offered;
 * - `onerror`: logged to the console and the button went dark, no explanation;
 * - `onend` after a silence: the state reset but nothing resumed, the user had to notice;
 * - the language was frozen at mount;
 * - nothing bounded the session length or the transcript.
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

export function readStoredDictationSettings(): DictationSettings {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { ...DEFAULT_DICTATION_SETTINGS };
  }

  try {
    const stored = localStorage.getItem(DICTATION_STORAGE_KEY);

    if (!stored) {
      return { ...DEFAULT_DICTATION_SETTINGS, language: speechLanguage() };
    }

    return parseDictationSettings(stored);
  } catch {
    return { ...DEFAULT_DICTATION_SETTINGS };
  }
}

export function writeStoredDictationSettings(settings: DictationSettings): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(DICTATION_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full quota must not break dictation itself.
  }
}

/**
 * Speaks text with the browser's own synthesis.
 *
 * Used by "read back after dictation" and by the voice settings tab's test button.
 * Returns false when the browser has no synthesis, so the caller can say so.
 */
export function speakText(text: string, language = 'fr-FR'): boolean {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return false;
  }

  try {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;

    const matchingVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang === language);

    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    window.speechSynthesis.speak(utterance);

    return true;
  } catch (caught) {
    console.error('Speech synthesis failed:', caught);

    return false;
  }
}

/** What the composer needs to render the button and the status line. */
export interface DictationState {
  /** At least one engine exists in this browser. */
  supported: boolean;

  /** Which engine a click will use. */
  engine: DictationEngine | null;

  isListening: boolean;

  /** Upload/transcription in flight (server engine only). */
  isTranscribing: boolean;

  /** The last failure, cleared when a new session starts. */
  error: DictationError | null;

  settings: DictationSettings;
}

interface UseSpeechRecognitionOptions {
  /** Current composer text, captured when listening starts so dictation appends to it. */
  input: string;

  /** Receives the full composer text (typed prefix + dictation so far). */
  onTranscript: (text: string) => void;
}

/** Delay before resuming after the engine stopped on its own (silence): not a busy loop. */
const SILENCE_RESTART_DELAY_MS = 250;

export function useSpeechRecognition({ input, onTranscript }: UseSpeechRecognitionOptions) {
  const [settings, setSettingsState] = useState<DictationSettings>(() => readStoredDictationSettings());
  const [engine, setEngine] = useState<DictationEngine | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);

  const inputRef = useRef(input);
  inputRef.current = input;

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Text present when listening started; every result is appended to it, never replaces it.
  const baseRef = useRef('');

  /** True while the user wants dictation; an unexpected `onend` restarts only in that state. */
  const wantsToListenRef = useRef(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const truncatedRef = useRef(false);
  const isListeningRef = useRef(false);

  isListeningRef.current = isListening;

  const applySettings = useCallback((next: DictationSettings) => {
    setSettingsState(next);
    writeStoredDictationSettings(next);

    if (recognitionRef.current) {
      recognitionRef.current.lang = next.language;
    }
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<DictationSettings>) => {
      applySettings({ ...settingsRef.current, ...patch });
    },
    [applySettings],
  );

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    if (limitTimerRef.current) {
      clearTimeout(limitTimerRef.current);
      limitTimerRef.current = null;
    }

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  /* ---------------- engine 1: Web Speech ---------------- */

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const recognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!recognitionClass) {
      return undefined;
    }

    const instance = new recognitionClass();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = settingsRef.current.language;

    const resumeIfWanted = (reason: string) => {
      restartTimerRef.current = setTimeout(() => {
        if (!wantsToListenRef.current) {
          return;
        }

        try {
          instance.start();
          setIsListening(true);
        } catch (restartError) {
          console.error(`Speech recognition could not ${reason}:`, restartError);
          wantsToListenRef.current = false;
          setIsListening(false);
        }
      }, SILENCE_RESTART_DELAY_MS);
    };

    instance.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0])
        .map((result) => result.transcript)
        .join('');

      const { text, truncated } = boundTranscript(transcript);

      if (truncated && !truncatedRef.current) {
        truncatedRef.current = true;
        setError({ code: 'too-long' });
      }

      onTranscriptRef.current(joinTranscript(baseRef.current, text));
    };

    instance.onerror = (event) => {
      /*
       * `aborted` is our own stop() and `no-speech` is silence: neither is a failure worth a
       * banner. Everything else must reach the user, which is exactly where a refused
       * microphone used to disappear into the console.
       */
      if (event.error === 'aborted') {
        return;
      }

      const code = mapSpeechError(event.error);

      if (code === 'no-speech') {
        return;
      }

      console.error('Speech recognition error:', event.error);
      setError({ code, detail: event.error ?? undefined });

      /*
       * A refused microphone fails the same way on restart, so the session ends with a
       * message. Everything else is transient: resume without asking the user to click again.
       */
      if (code === 'permission-denied' || code === 'no-microphone' || code === 'insecure-context') {
        wantsToListenRef.current = false;
        setIsListening(false);

        return;
      }

      setIsListening(false);
      resumeIfWanted('restart');
    };

    /*
     * The engine stops by itself after a silence. Reflect the stop, and resume while the
     * user still wants to dictate: this unexplained stop was the second silent fault.
     */
    instance.onend = () => {
      setIsListening(false);

      if (wantsToListenRef.current) {
        resumeIfWanted('resume');
      }
    };

    recognitionRef.current = instance;

    return () => {
      wantsToListenRef.current = false;
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;

      try {
        instance.abort();
      } catch {
        // Never started: nothing to abort.
      }

      recognitionRef.current = null;
    };
  }, []);

  /* ---------------- engine 2: MediaRecorder + /api/transcribe ---------------- */

  const transcribe = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);

    try {
      const mimeType = blob.type || 'audio/webm';
      const body = new FormData();

      body.append('file', new File([blob], `dictation.${recordingExtension(mimeType)}`, { type: mimeType }));
      body.append('language', settingsRef.current.language);

      const response = await fetch('/api/transcribe', { method: 'POST', body });

      if (!response.ok) {
        let payload: unknown = null;

        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        console.error('Transcription failed:', response.status, payload);
        setError({ code: mapTranscribeFailure(response.status, payload) });

        return;
      }

      const payload = (await response.json()) as { text?: unknown };
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';

      if (!text) {
        setError({ code: 'no-speech' });

        return;
      }

      const { text: bounded, truncated } = boundTranscript(text);

      if (truncated) {
        setError({ code: 'too-long' });
      }

      onTranscriptRef.current(joinTranscript(baseRef.current, bounded));

      if (settingsRef.current.speakBack) {
        speakText(bounded, settingsRef.current.language);
      }
    } catch (caught) {
      console.error('Transcription request failed:', caught);
      setError({ code: 'network' });
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const startServerRecording = useCallback(async () => {
    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (caught) {
      const name = caught instanceof Error ? caught.name : '';

      console.error('Microphone could not be opened:', name);

      setError({
        code:
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'permission-denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'no-microphone'
              : 'unknown',
      });
      wantsToListenRef.current = false;

      return;
    }

    // A denied permission on an insecure origin resolves with no track instead of rejecting.
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      setError({ code: 'no-microphone' });
      wantsToListenRef.current = false;

      return;
    }

    streamRef.current = stream;

    const mimeType = pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    chunksRef.current = [];
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
      setError({ code: 'unknown' });
    };

    recorder.onstop = () => {
      stopTracks();

      const elapsed = Date.now() - startedAtRef.current;

      if (chunksRef.current.length === 0) {
        return;
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];

      if (elapsed < MIN_CLIP_MS || blob.size === 0) {
        setError({ code: 'too-short' });

        return;
      }

      void transcribe(blob);
    };

    recorder.start();
    setIsListening(true);

    // Bounded session: an open microphone stops on its own after the maximum duration.
    limitTimerRef.current = setTimeout(() => {
      wantsToListenRef.current = false;

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }

      setIsListening(false);
    }, MAX_DICTATION_MS);
  }, [stopTracks, transcribe]);

  /* ---------------- public surface ---------------- */

  /** Which engine this browser can use, given the preference. Null: neither. */
  const detectEngine = useCallback((): DictationEngine | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const hasSpeechRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasMediaRecorder = typeof window.MediaRecorder !== 'undefined';
    const hasUserMedia = Boolean(navigator.mediaDevices?.getUserMedia);

    const capable = pickEngine({ hasSpeechRecognition, hasMediaRecorder, hasUserMedia });

    if (capable === 'server' && !settingsRef.current.serverFallback) {
      return null;
    }

    return capable;
  }, []);

  // Keeps the reported engine in sync with the capability of the browser and the preference.
  useEffect(() => {
    setEngine(detectEngine());
  }, [detectEngine, settings.serverFallback]);

  const startListening = useCallback(() => {
    setError(null);
    truncatedRef.current = false;

    const active = detectEngine();

    if (active === 'browser') {
      const recognition = recognitionRef.current;

      if (!recognition) {
        setError({ code: 'unknown' });

        return;
      }

      baseRef.current = inputRef.current;
      wantsToListenRef.current = true;
      recognition.lang = settingsRef.current.language;

      try {
        recognition.start();
        setIsListening(true);
      } catch (caught) {
        // start() throws if it is already running; the button must not claim a state it is not in.
        console.error('Speech recognition could not start:', caught);
      }

      return;
    }

    if (active === 'server') {
      baseRef.current = inputRef.current;
      wantsToListenRef.current = true;
      void startServerRecording();

      return;
    }

    setError({ code: 'unknown' });
  }, [detectEngine, startServerRecording]);

  const stopListening = useCallback(() => {
    wantsToListenRef.current = false;
    clearTimers();

    if (recognitionRef.current && isListeningRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped.
      }
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }

    setIsListening(false);
  }, [clearTimers]);

  const abortListening = useCallback(() => {
    wantsToListenRef.current = false;
    clearTimers();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Never started.
      }
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      chunksRef.current = [];
      recorderRef.current.stop();
    }

    stopTracks();
    baseRef.current = '';
    setIsListening(false);
  }, [clearTimers, stopTracks]);

  const clearError = useCallback(() => setError(null), []);

  const state: DictationState = {
    supported: engine !== null,
    engine,
    isListening,
    isTranscribing,
    error,
    settings,
  };

  return {
    ...state,
    startListening,
    stopListening,
    abortListening,
    clearError,
    updateSettings,

    /** Message the UI shows for the current failure, already phrased for the user. */
    errorMessage: error ? describeDictationError(error.code) : null,
  };
}
