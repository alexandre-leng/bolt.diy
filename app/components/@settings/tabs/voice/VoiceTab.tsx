import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '~/components/ui/Card';
import { Switch } from '~/components/ui/Switch';
import {
  DICTATION_LANGUAGES,
  MAX_DICTATION_MS,
  MAX_DICTATION_BYTES,
  type DictationSettings,
  parseDictationSettings,
} from '~/lib/dictation';
import { readStoredDictationSettings, writeStoredDictationSettings } from '~/lib/hooks/useSpeechRecognition';
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

  const updateDictation = (patch: Partial<DictationSettings>) => {
    const next = parseDictationSettings({ ...dictation, ...patch });

    setDictation(next);
    writeStoredDictationSettings(next);

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

      utterance.onerror = () => toast.error('La synthèse vocale a échoué pour cette voix.');

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
                Voix ({voices.length} disponible{voices.length === 1 ? '' : 's'})
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
              disabled={!synthesisSupported}
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
              onClick={() => window.speechSynthesis.cancel()}
              disabled={!synthesisSupported}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-bolt-elements-borderColor px-3 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive disabled:opacity-50"
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
