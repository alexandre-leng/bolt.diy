import Cookies from 'js-cookie';
import React, { useEffect, useMemo, useState } from 'react';
import { getApiKeysFromCookies } from '~/components/chat/APIKeyManager';
import { Card, CardContent } from '~/components/ui/Card';
import { Switch } from '~/components/ui/Switch';
import {
  DICTATION_LANGUAGES,
  MAX_DICTATION_MS,
  MAX_DICTATION_BYTES,
  type DictationSettings,
  parseDictationSettings,
} from '~/lib/dictation';
import {
  DICTATION_PROVIDERS,
  type TranscriptionSettings,
  describeKeyState,
  dictationProvider,
  readStoredVoiceSettings,
  readTranscriptionSettings,
  writeStoredVoiceSettings,
} from '~/lib/dictation-config';
import { readStoredDictationSettings } from '~/lib/hooks/useSpeechRecognition';
import { toast } from '~/lib/toastify';
import { classNames } from '~/utils/classNames';

/*
 * Voice settings: dictation (speech to text) and text to speech.
 *
 * Dictation preferences live in localStorage under one key that the composer hook reads and
 * writes, so changing the language here changes what the mic uses immediately (there is no
 * second source of truth). The TTS voices are the browser's own `speechSynthesis` list: nothing
 * is uploaded, which is why this page offers a test button instead of an API key.
 *
 * Everything on this page reports what it found in the browser: a panel that silently shows an
 * empty voice list would read as a broken feature rather than as "this browser has none".
 */

const SAMPLE_TEXT = 'Bonjour, ceci est un test de la voix de synthèse choisie.';

const selectClass = classNames(
  'w-full rounded-lg px-3 py-2 text-sm',
  'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
  'text-bolt-elements-textPrimary',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus',
);

const inputClass = classNames(
  'w-full rounded-lg px-3 py-2 text-sm',
  'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
  'text-bolt-elements-textPrimary',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus',
);

/**
 * Records a short clip from the microphone, for the transcription test.
 *
 * The test has to prove the KEY, the SERVICE and the MODEL together, which only a real call can
 * do: so it records 3 seconds (the user is told to speak) and posts it exactly as the composer
 * does. Synthesizing a sample locally was tried and rejected: `speechSynthesis` cannot be routed
 * into a MediaRecorder reliably, and a fake pass would be worse than no test.
 */
async function recordSample(durationMs = 3000): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  try {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    recorder.stop();
    await stopped;

    return new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function useSpeechVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [synthesisSupported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window);

  useEffect(() => {
    if (!synthesisSupported) {
      return undefined;
    }

    const load = () => setVoices(window.speechSynthesis.getVoices());

    load();

    /*
     * Chromium fills the voice list asynchronously: the first `getVoices()` is empty and
     * `voiceschanged` never fires on some versions, so the list is also polled briefly.
     */
    window.speechSynthesis.addEventListener('voiceschanged', load);

    const timers = [200, 600, 1500].map((delay) => setTimeout(load, delay));

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      timers.forEach(clearTimeout);
    };
  }, [synthesisSupported]);

  return { voices, synthesisSupported };
}

export default function VoiceTab() {
  const [dictation, setDictation] = useState<DictationSettings>(() => readStoredDictationSettings());

  /*
   * Transcription service and model: the same choice the route receives with each clip. Stored
   * beside the dictation preferences (one key, one source of truth) so the composer never reads
   * a stale value.
   */
  const [transcription, setTranscription] = useState<TranscriptionSettings>(
    () => readStoredVoiceSettings().transcription,
  );

  /** Keys typed in this browser, under the same `apiKeys` cookie the Cloud Providers tab uses. */
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    try {
      return getApiKeysFromCookies();
    } catch {
      return {};
    }
  });

  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const { voices, synthesisSupported } = useSpeechVoices();
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);

  /*
   * Voices matching the dictation language first: the list from a French system is otherwise
   * dominated by English voices, and picking the wrong one is the most common mistake here.
   */
  const sortedVoices = useMemo(() => {
    const prefix = dictation.language.split('-')[0];

    return [...voices].sort((a, b) => {
      const aMatches = a.lang.toLowerCase().startsWith(prefix);
      const bMatches = b.lang.toLowerCase().startsWith(prefix);

      if (aMatches !== bMatches) {
        return aMatches ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
  }, [voices, dictation.language]);

  useEffect(() => {
    if (!selectedVoice && sortedVoices.length > 0) {
      setSelectedVoice(sortedVoices[0].name);
    }
  }, [sortedVoices, selectedVoice]);

  const updateTranscription = (patch: Partial<TranscriptionSettings>) => {
    const next = readTranscriptionSettings({
      sttProvider: patch.provider ?? transcription.provider,
      sttModel: patch.model ?? transcription.model,
    });

    setTranscription(next);
    writeStoredVoiceSettings(dictation, next);
    setTestResult(null);
  };

  /**
   * Saves a key into the shared `apiKeys` cookie.
   *
   * Same storage the Cloud Providers tab writes and `/api/transcribe` reads, so a key is typed
   * once and never duplicated. An empty draft removes the entry (the deployment key can then
   * take over), which is how a user revokes a key typed by mistake.
   */
  const saveKey = (apiKeyId: 'OpenAI' | 'Groq') => {
    const draft = (keyDrafts[apiKeyId] ?? '').trim();
    const current = getApiKeysFromCookies();
    const next = { ...current, [apiKeyId]: draft };

    if (!draft) {
      delete next[apiKeyId];
    }

    Cookies.set('apiKeys', JSON.stringify(next));
    setApiKeys(next);
    setKeyDrafts((previous) => ({ ...previous, [apiKeyId]: '' }));
    setKeyVisible((previous) => ({ ...previous, [apiKeyId]: false }));
    toast.success(draft ? `Clé ${apiKeyId} enregistrée pour cet appareil.` : `Clé ${apiKeyId} retirée.`);
    setTestResult(null);
  };

  /**
   * Real end-to-end test: synthesizes one sentence locally, then posts it to `/api/transcribe`
   * exactly as the composer does. Proves the key, the service and the model together, which no
   * client-side check can.
   */
  const testTranscription = async () => {
    const provider = dictationProvider(transcription.provider);

    setTesting(true);
    setTestResult(null);

    try {
      const blob = await recordSample();

      if (blob.size === 0) {
        setTestResult({ ok: false, message: 'Rien n’a été enregistré. Vérifiez le microphone.' });

        return;
      }

      const body = new FormData();
      body.append('file', new File([blob], `test.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`, { type: blob.type }));
      body.append('language', dictation.language);
      body.append('provider', transcription.provider);
      body.append('model', transcription.model);

      const response = await fetch('/api/transcribe', { method: 'POST', body });
      const payload = (await response.json().catch(() => null)) as { text?: string; message?: string } | null;

      if (!response.ok) {
        setTestResult({
          ok: false,
          message: `${payload?.message ?? `Erreur ${response.status}`} (${provider.label} / ${transcription.model})`,
        });

        return;
      }

      setTestResult({
        ok: true,
        message: `Test réussi avec ${provider.label} / ${transcription.model} : « ${payload?.text ?? ''} »`,
      });
    } catch (error) {
      console.error('Transcription test failed:', error);
      setTestResult({ ok: false, message: 'Le test a échoué : requête impossible.' });
    } finally {
      setTesting(false);
    }
  };

  const updateDictation = (patch: Partial<DictationSettings>) => {
    const next = parseDictationSettings({ ...dictation, ...patch });

    setDictation(next);
    writeStoredVoiceSettings(next, transcription);

    // The composer hook reads this key on mount and on language change: tell it right away.
    window.dispatchEvent(new CustomEvent('bolt:dictation-settings', { detail: next }));
  };

  const speak = () => {
    if (!synthesisSupported) {
      toast.error('Ce navigateur ne propose pas de synthèse vocale.');

      return;
    }

    const voice = voices.find((entry) => entry.name === selectedVoice);

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(SAMPLE_TEXT);
      utterance.lang = voice?.lang ?? dictation.language;
      utterance.rate = rate;
      utterance.pitch = pitch;

      if (voice) {
        utterance.voice = voice;
      }

      utterance.onerror = () => {
        setIsSpeaking(false);
        toast.error('La synthèse vocale a échoué pour cette voix.');
      };

      utterance.onend = () => setIsSpeaking(false);

      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('Speech synthesis failed:', error);
      toast.error('La synthèse vocale a échoué.');
    }
  };

  const typedDictationAvailable =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const recorderAvailable = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';

  return (
    <div className="space-y-4">
      {/* ---------- Dictation ---------- */}
      <Card className="bg-bolt-elements-background-depth-2" data-testid="voice-dictation-card">
        <CardContent className="!p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="i-ph:microphone-fill h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-medium text-bolt-elements-textPrimary">Dictée (voix vers texte)</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dictation-language" className="mb-2 block text-sm text-bolt-elements-textSecondary">
                Langue de dictée
              </label>
              <select
                id="dictation-language"
                value={dictation.language}
                onChange={(event) => updateDictation({ language: event.target.value })}
                className={classNames(
                  'w-full rounded-lg px-3 py-2 text-sm',
                  'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
                  'text-bolt-elements-textPrimary',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus',
                )}
              >
                {DICTATION_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                Appliquée immédiatement au bouton micro du composeur.
              </p>
            </div>

            <div className="space-y-3">
              <label className="flex items-start justify-between gap-3">
                <span className="text-sm text-bolt-elements-textSecondary">
                  Afficher le bouton micro
                  <span className="block text-xs">Le masquer libère la place dans le composeur.</span>
                </span>
                <Switch
                  aria-label="Afficher le bouton micro"
                  checked={dictation.enabled}
                  onCheckedChange={(checked) => updateDictation({ enabled: checked })}
                />
              </label>

              <label className="flex items-start justify-between gap-3">
                <span className="text-sm text-bolt-elements-textSecondary">
                  Transcription serveur en secours
                  <span className="block text-xs">
                    Utilisée quand le navigateur n’a pas de reconnaissance vocale (Firefox, Safari), via Whisper.
                  </span>
                </span>
                <Switch
                  aria-label="Transcription serveur en secours"
                  checked={dictation.serverFallback}
                  onCheckedChange={(checked) => updateDictation({ serverFallback: checked })}
                />
              </label>

              <label className="flex items-start justify-between gap-3">
                <span className="text-sm text-bolt-elements-textSecondary">
                  Relire le texte dicté
                  <span className="block text-xs">Vérification à l’oreille, juste après la transcription.</span>
                </span>
                <Switch
                  aria-label="Relire le texte dicté"
                  checked={dictation.speakBack}
                  onCheckedChange={(checked) => updateDictation({ speakBack: checked })}
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-xs text-bolt-elements-textSecondary">
            <p>
              Reconnaissance du navigateur :{' '}
              <span className={typedDictationAvailable ? 'text-green-600 dark:text-green-400' : 'text-amber-600'}>
                {typedDictationAvailable ? 'disponible' : 'absente'}
              </span>{' '}
              · Enregistrement audio :{' '}
              <span className={recorderAvailable ? 'text-green-600 dark:text-green-400' : 'text-amber-600'}>
                {recorderAvailable ? 'disponible' : 'absent'}
              </span>
            </p>
            <p className="mt-1">
              Limites appliquées : {Math.round(MAX_DICTATION_MS / 60000)} min et{' '}
              {Math.round(MAX_DICTATION_BYTES / (1024 * 1024))} Mo par enregistrement. La dictée du navigateur envoie
              l’audio au service du navigateur ; la transcription serveur l’envoie à Whisper.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Transcription service (server engine) ---------- */}
      <Card className="bg-bolt-elements-background-depth-2" data-testid="voice-transcription-card">
        <CardContent className="!p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="i-ph:cloud-arrow-up-fill h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-medium text-bolt-elements-textPrimary">Transcription serveur (OpenAI, Groq)</h2>
          </div>

          <p className="text-xs text-bolt-elements-textSecondary">
            Utilisée quand le navigateur n’a pas de reconnaissance vocale (Firefox, Safari, Brave). La clé saisie ici
            est celle du fournisseur de modèles : elle est enregistrée dans ce navigateur, et jamais renvoyée par le
            serveur.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="stt-provider" className="mb-2 block text-sm text-bolt-elements-textSecondary">
                Service de transcription
              </label>
              <select
                id="stt-provider"
                value={transcription.provider}
                onChange={(event) =>
                  updateTranscription({
                    provider: event.target.value === 'groq' ? 'groq' : 'openai',
                    model: dictationProvider(event.target.value).defaultModel,
                  })
                }
                className={selectClass}
              >
                {DICTATION_PROVIDERS.map((provider) => (
                  <option key={provider.name} value={provider.name}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="stt-model" className="mb-2 block text-sm text-bolt-elements-textSecondary">
                Modèle
              </label>
              <select
                id="stt-model"
                value={transcription.model}
                onChange={(event) => updateTranscription({ model: event.target.value })}
                className={selectClass}
              >
                {dictationProvider(transcription.provider).models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-bolt-elements-textSecondary">
                {dictationProvider(transcription.provider).models.find((model) => model.id === transcription.model)
                  ?.note ?? ''}
              </p>
            </div>
          </div>

          {/* ---- keys: one per service, same cookie as the provider settings ---- */}
          <div className="space-y-3">
            {DICTATION_PROVIDERS.map((provider) => {
              const storedKey = apiKeys[provider.apiKeyId];
              const state = describeKeyState(storedKey, false);
              const visible = keyVisible[provider.apiKeyId] ?? false;
              const draft = keyDrafts[provider.apiKeyId] ?? '';

              return (
                <div
                  key={provider.name}
                  className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-bolt-elements-textPrimary">
                      Clé {provider.label}
                      <span className="ml-2 text-xs font-normal text-bolt-elements-textSecondary">
                        {state === 'account' ? 'enregistrée dans ce navigateur' : 'non renseignée'}
                      </span>
                    </span>
                    <a
                      href={provider.keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-bolt-elements-textSecondary underline hover:text-bolt-elements-textPrimary"
                    >
                      obtenir une clé
                    </a>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <input
                        id={`stt-key-${provider.name}`}
                        type={visible ? 'text' : 'password'}
                        value={draft}
                        onChange={(event) =>
                          setKeyDrafts((previous) => ({ ...previous, [provider.apiKeyId]: event.target.value }))
                        }
                        placeholder={
                          storedKey ? 'Clé enregistrée, saisissez-en une nouvelle pour la remplacer' : 'sk-…'
                        }
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`Clé API ${provider.label}`}
                        className={classNames(inputClass, 'pr-12')}
                      />
                      <button
                        type="button"
                        onClick={() => setKeyVisible((previous) => ({ ...previous, [provider.apiKeyId]: !visible }))}
                        aria-label={visible ? `Masquer la clé ${provider.label}` : `Afficher la clé ${provider.label}`}
                        aria-pressed={visible}
                        title={visible ? 'Masquer' : 'Afficher'}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus"
                      >
                        {visible ? <div className="i-ph:eye-slash" /> : <div className="i-ph:eye" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveKey(provider.apiKeyId)}
                      className="min-h-[44px] rounded-lg bg-bolt-elements-button-primary-background px-3 py-2 text-sm font-medium text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus"
                    >
                      Enregistrer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={testTranscription}
              disabled={testing}
              className={classNames(
                'inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-bolt-elements-borderColor px-3 py-2 text-sm text-bolt-elements-textPrimary',
                'hover:bg-bolt-elements-item-backgroundActive focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <div className={testing ? 'i-ph:circle-notch-bold animate-spin' : 'i-ph:waveform'} />
              {testing ? 'Enregistrement (3 s), parlez…' : 'Tester la transcription'}
            </button>
            <span className="text-xs text-bolt-elements-textSecondary">
              Enregistre 3 secondes puis transcrit pour de vrai avec le service et le modèle choisis.
            </span>
          </div>

          {testResult ? (
            <p
              role="status"
              aria-live="polite"
              className={classNames(
                'rounded-lg border px-3 py-2 text-xs',
                testResult.ok
                  ? 'border-green-500/40 bg-green-500/5 text-bolt-elements-textPrimary'
                  : 'border-red-500/40 bg-red-500/5 text-bolt-elements-textPrimary',
              )}
            >
              {testResult.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------- Text to speech ---------- */}
      <Card className="bg-bolt-elements-background-depth-2" data-testid="voice-tts-card">
        <CardContent className="!p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="i-ph:speaker-high-fill h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-medium text-bolt-elements-textPrimary">Synthèse vocale (texte vers voix)</h2>
          </div>

          {!synthesisSupported ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Ce navigateur ne propose pas de synthèse vocale, les réglages ci-dessous resteront sans effet.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tts-voice" className="mb-2 block text-sm text-bolt-elements-textSecondary">
                {voices.length === 0
                  ? 'Voix (aucune détectée pour l’instant)'
                  : `Voix (${voices.length} disponible${voices.length === 1 ? '' : 's'})`}
              </label>
              <select
                id="tts-voice"
                value={selectedVoice}
                onChange={(event) => setSelectedVoice(event.target.value)}
                className={classNames(
                  'w-full rounded-lg px-3 py-2 text-sm',
                  'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
                  'text-bolt-elements-textPrimary',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus',
                )}
              >
                {sortedVoices.length === 0 ? <option value="">Aucune voix détectée</option> : null}
                {sortedVoices.map((voice) => (
                  <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                    {voice.name} ({voice.lang}){voice.localService ? ' · locale' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="tts-rate" className="mb-1 block text-sm text-bolt-elements-textSecondary">
                  Vitesse : {rate.toFixed(2)}×
                </label>
                <input
                  id="tts-rate"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={rate}
                  onChange={(event) => setRate(Number(event.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
              <div>
                <label htmlFor="tts-pitch" className="mb-1 block text-sm text-bolt-elements-textSecondary">
                  Hauteur : {pitch.toFixed(2)}
                </label>
                <input
                  id="tts-pitch"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={pitch}
                  onChange={(event) => setPitch(Number(event.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={speak}
              disabled={!synthesisSupported || voices.length === 0}
              className={classNames(
                'inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                'bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text',
                'hover:bg-bolt-elements-button-primary-backgroundHover',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <div className="i-ph:play-fill" />
              Écouter un exemple
            </button>
            <button
              type="button"
              onClick={() => {
                window.speechSynthesis.cancel();
                setIsSpeaking(false);
              }}
              disabled={!synthesisSupported || !isSpeaking}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-bolt-elements-borderColor px-3 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="i-ph:stop-fill" />
              Arrêter
            </button>
            <span className="text-xs text-bolt-elements-textSecondary">
              Synthèse locale du navigateur : aucun texte n’est envoyé à un serveur.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
