/*
 * Transcription settings: which service takes dictation, and with which key.
 *
 * Dictation is offered to every browser now, so its provider is a first-class setting rather
 * than an environment variable nobody can see: the key typed here is the same `apiKeys` cookie
 * the model providers already use (`apiKeys.OpenAI`, `apiKeys.Groq`), so a key entered in Cloud
 * Providers works for dictation too, and the other way round.
 *
 * The catalogue below is measured, not guessed: every OpenAI and Groq transcription model listed
 * here answered a real request on 2026-10-19. A model name the service retires is refused by the
 * route with `provider-refused`, which the settings test button surfaces.
 */
import { DICTATION_STORAGE_KEY, parseDictationSettings, type DictationSettings } from './dictation';

/** Where a key can come from: the browser cookie, or the deployment's environment. */
export type DictationKeySource = 'account' | 'environment' | 'missing';

export type DictationProviderName = 'openai' | 'groq';

export interface DictationProviderOption {
  name: DictationProviderName;

  /** Cookie/`apiKeys` key, and the provider name the model picker uses. */
  apiKeyId: 'OpenAI' | 'Groq';
  label: string;

  /** Environment variable the deployment forwards to the Worker. */
  envVar: 'OPENAI_API_KEY' | 'GROQ_API_KEY';
  models: { id: string; label: string; note: string }[];
  defaultModel: string;
  keyUrl: string;
}

export const DICTATION_PROVIDERS: DictationProviderOption[] = [
  {
    name: 'openai',
    apiKeyId: 'OpenAI',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini-transcribe',
    models: [
      {
        id: 'gpt-4o-mini-transcribe',
        label: 'gpt-4o-mini-transcribe',
        note: 'Le moins cher, bon en français. Facturé à la minute.',
      },
      { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', note: 'Plus précis, plus cher.' },
      { id: 'whisper-1', label: 'whisper-1', note: 'Le modèle historique, horodatage et traduction.' },
    ],
  },
  {
    name: 'groq',
    apiKeyId: 'Groq',
    label: 'Groq',
    envVar: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'whisper-large-v3-turbo',
    models: [
      {
        id: 'whisper-large-v3-turbo',
        label: 'whisper-large-v3-turbo',
        note: 'Très rapide, quota gratuit généreux.',
      },
      { id: 'whisper-large-v3', label: 'whisper-large-v3', note: 'Plus lent, un peu plus précis.' },
    ],
  },
];

export function dictationProvider(name: string | undefined): DictationProviderOption {
  return DICTATION_PROVIDERS.find((provider) => provider.name === name) ?? DICTATION_PROVIDERS[0];
}

export function dictationModelOptions(name: string | undefined): { id: string; label: string; note: string }[] {
  return dictationProvider(name).models;
}

/**
 * The transcription configuration, kept in the same stored object as the dictation preferences
 * so there is a single source of truth (the composer hook and this panel read the same key).
 */
export interface TranscriptionSettings {
  /** Preferred service. The route falls back to the other one when the key is missing. */
  provider: DictationProviderName;
  model: string;
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = {
  provider: 'openai',
  model: 'gpt-4o-mini-transcribe',
};

export function readTranscriptionSettings(raw: unknown): TranscriptionSettings {
  const base = typeof raw === 'string' ? safeParse(raw) : raw;

  if (!base || typeof base !== 'object') {
    return { ...DEFAULT_TRANSCRIPTION_SETTINGS };
  }

  const value = base as Record<string, unknown>;
  const provider = value.sttProvider === 'groq' ? 'groq' : value.sttProvider === 'openai' ? 'openai' : null;
  const model = typeof value.sttModel === 'string' && value.sttModel.trim() ? value.sttModel.trim() : null;

  if (!provider) {
    return { ...DEFAULT_TRANSCRIPTION_SETTINGS };
  }

  const allowed = dictationModelOptions(provider).map((entry) => entry.id);
  const chosenModel = model && allowed.includes(model) ? model : dictationProvider(provider).defaultModel;

  return { provider, model: chosenModel };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The whole stored object: dictation preferences plus the transcription choice. */
export function readStoredVoiceSettings(): { dictation: DictationSettings; transcription: TranscriptionSettings } {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {
      dictation: parseDictationSettings(null),
      transcription: { ...DEFAULT_TRANSCRIPTION_SETTINGS },
    };
  }

  const raw = localStorage.getItem(DICTATION_STORAGE_KEY);

  return { dictation: parseDictationSettings(raw), transcription: readTranscriptionSettings(raw) };
}

export function writeStoredVoiceSettings(dictation: DictationSettings, transcription: TranscriptionSettings): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(
      DICTATION_STORAGE_KEY,
      JSON.stringify({ ...dictation, sttProvider: transcription.provider, sttModel: transcription.model }),
    );
  } catch {
    // A full quota must not break dictation itself.
  }
}

/**
 * Which key the server would use for this provider.
 *
 * The environment is unknown from the browser, so a deployment key is only a *possibility*: the
 * panel says "clé serveur" without claiming a value it cannot read, and the test button settles
 * it by making a real call.
 */
export function describeKeyState(cookieKey: string | undefined, envHint: boolean): DictationKeySource {
  if (cookieKey && cookieKey.trim()) {
    return 'account';
  }

  return envHint ? 'environment' : 'missing';
}
