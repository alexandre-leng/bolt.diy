/*
 * Dictation contract shared by the browser hook, the server route and the UI.
 *
 * Dictation has two engines and they fail for different reasons, so the messages
 * live in ONE place: the button, the settings panel and `/api/transcribe` all map
 * their raw error to a `DictationErrorCode`, and the UI renders `describeDictationError`.
 * A code that reaches no message would leave the user with a mic that just stops.
 */

/** Languages offered in the composer and in Settings. First entry is the default. */
export const DICTATION_LANGUAGES = [
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'fr-CA', label: 'Français (Canada)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Español' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'zh-CN', label: '中文 (简体)' },
  { value: 'ar-SA', label: 'العربية' },
] as const;

export const DICTATION_STORAGE_KEY = 'bolt_dictation_settings';

/** Whisper rejects a body it cannot decode, and pays per minute: one clip is bounded. */
export const MAX_DICTATION_BYTES = 12 * 1024 * 1024;

/** A single utterance is capped: an open session must not run forever. */
export const MAX_DICTATION_MS = 5 * 60 * 1000;

/** The transcript is bounded too, so a stuck engine cannot flood the composer. */
export const MAX_TRANSCRIPT_CHARS = 8000;

/** Shortest clip worth uploading: below this Whisper answers 400 "audio too short". */
export const MIN_CLIP_MS = 350;

export type DictationEngine = 'browser' | 'server';

export type DictationErrorCode =
  | 'permission-denied'
  | 'no-microphone'
  | 'insecure-context'
  | 'network'
  | 'no-speech'
  | 'key-missing'
  | 'too-short'
  | 'too-long'
  | 'quota'
  | 'provider-refused'
  | 'unknown';

export interface DictationError {
  code: DictationErrorCode;

  /** Raw engine detail or server message, kept for the console, never trusted for display. */
  detail?: string;
}

export interface DictationSettings {
  /** Default language of the dictation, persisted per browser and per account. */
  language: string;

  /** Microphone in the composer. Turning it off hides the button entirely. */
  enabled: boolean;

  /** Transcribe on the server when the browser has no Web Speech API, or when it fails. */
  serverFallback: boolean;

  /** Say the dictated text back once transcribed (verification by ear). */
  speakBack: boolean;
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  language: 'fr-FR',
  enabled: true,
  serverFallback: true,
  speakBack: false,
};

export function isDictationLanguage(value: unknown): value is string {
  return typeof value === 'string' && DICTATION_LANGUAGES.some((language) => language.value === value);
}

/** Reads persisted settings, falling back per field: one corrupt key must not disable dictation. */
export function parseDictationSettings(raw: unknown): DictationSettings {
  if (typeof raw === 'string') {
    try {
      return parseDictationSettings(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_DICTATION_SETTINGS };
    }
  }

  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DICTATION_SETTINGS };
  }

  const value = raw as Record<string, unknown>;

  return {
    language: isDictationLanguage(value.language) ? value.language : DEFAULT_DICTATION_SETTINGS.language,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_DICTATION_SETTINGS.enabled,
    serverFallback:
      typeof value.serverFallback === 'boolean' ? value.serverFallback : DEFAULT_DICTATION_SETTINGS.serverFallback,
    speakBack: typeof value.speakBack === 'boolean' ? value.speakBack : DEFAULT_DICTATION_SETTINGS.speakBack,
  };
}

/** `fr-FR` for the recogniser, `fr` for Whisper: the same locale, two shapes. */
export function whisperLanguage(language: string): string {
  return language.split('-')[0].toLowerCase();
}

const ERRORS: Record<DictationErrorCode, string> = {
  'permission-denied':
    'Micro refusé. Autorisez le microphone dans les réglages du navigateur pour ce site, puis réessayez.',
  'no-microphone': 'Aucun microphone détecté sur cet appareil.',
  'insecure-context': 'La dictée exige une connexion sécurisée (HTTPS).',
  network: 'La transcription a échoué (réseau ou service indisponible). Réessayez dans un instant.',
  'no-speech': 'Rien n’a été entendu. Parlez plus près du micro.',
  'key-missing': 'Transcription serveur indisponible : aucune clé OpenAI ou Groq n’est configurée.',
  'too-short': 'Enregistrement trop court pour être transcrit.',
  'too-long': 'Enregistrement trop long. Dictez par passages plus courts.',
  quota: 'Quota de transcription atteint sur le service. Réessayez plus tard.',
  'provider-refused': 'Le service de transcription a refusé l’audio (format non pris en charge).',
  unknown: 'La dictée s’est arrêtée. Réessayez.',
};

/** A message the user can act on, for every code a failed dictation can produce. */
export function describeDictationError(code: DictationErrorCode): string {
  return ERRORS[code] ?? ERRORS.unknown;
}

/** Index of the next language, so the composer can cycle without a menu. */
export function nextDictationLanguage(language: string): string {
  const index = DICTATION_LANGUAGES.findIndex((entry) => entry.value === language);

  return DICTATION_LANGUAGES[(index + 1) % DICTATION_LANGUAGES.length].value;
}

/** `fr-FR` -> `FR`, shown on the button so the language is never a guess. */
export function languageBadge(language: string): string {
  const region = language.split('-')[1];

  return (region ?? language).toUpperCase();
}

/**
 * Bounds the transcript before it reaches the composer.
 *
 * Returns the accepted slice and whether anything was dropped, so the caller can say so
 * instead of silently truncating a long dictation.
 */
export function boundTranscript(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TRANSCRIPT_CHARS) {
    return { text, truncated: false };
  }

  return { text: text.slice(0, MAX_TRANSCRIPT_CHARS), truncated: true };
}

/**
 * Maps a Web Speech `SpeechRecognitionErrorEvent.error` to a code.
 *
 * `aborted` is the user stopping on purpose, and `no-speech` is silence: neither is a failure
 * the UI should shout about, but both must leave the button in its resting state.
 */
export function mapSpeechError(error: string | undefined): DictationErrorCode {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied';
    case 'audio-capture':
      return 'no-microphone';
    case 'network':
      return 'network';
    case 'no-speech':
      return 'no-speech';
    case 'language-not-supported':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Maps a failed `/api/transcribe` response to a code, so the client never shows a raw server string. */
export function mapTranscribeFailure(status: number, body: unknown): DictationErrorCode {
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;

  if (typeof code === 'string' && code in ERRORS) {
    return code as DictationErrorCode;
  }

  if (status === 401 || status === 403) {
    return 'key-missing';
  }

  if (status === 413) {
    return 'too-long';
  }

  if (status === 429) {
    return 'quota';
  }

  if (status === 400) {
    return 'provider-refused';
  }

  return 'network';
}

/**
 * Picks the engine for a browser.
 *
 * `browser` is fastest and free, but exists only in Chromium and sends the audio to Google.
 * `server` reaches every browser that has `getUserMedia`, and is the only option in Firefox.
 */
export function pickEngine(options: {
  hasSpeechRecognition: boolean;
  hasMediaRecorder: boolean;
  hasUserMedia: boolean;
}): DictationEngine | null {
  if (options.hasSpeechRecognition) {
    return 'browser';
  }

  if (options.hasUserMedia && options.hasMediaRecorder) {
    return 'server';
  }

  return null;
}

/**
 * First recording MIME type the browser can produce that the transcription services accept.
 *
 * Safari has no WebM: it records MP4/AAC, which Whisper reads. Returning the empty string
 * would make `MediaRecorder` pick its default, which is how Safari used to send audio the
 * provider refused.
 */
export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];

  return candidates.find((type) => isTypeSupported(type)) ?? '';
}

/** File name extension Whisper infers the format from: a bare blob with no name is refused. */
export function recordingExtension(mimeType: string): string {
  if (mimeType.includes('webm')) {
    return 'webm';
  }

  if (mimeType.includes('ogg')) {
    return 'ogg';
  }

  if (mimeType.includes('mp4')) {
    return 'm4a';
  }

  if (mimeType.includes('mpeg')) {
    return 'mp3';
  }

  return 'webm';
}
