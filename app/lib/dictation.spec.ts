import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DICTATION_SETTINGS,
  DICTATION_LANGUAGES,
  MAX_TRANSCRIPT_CHARS,
  boundTranscript,
  describeDictationError,
  isDictationLanguage,
  languageBadge,
  mapSpeechError,
  mapTranscribeFailure,
  nextDictationLanguage,
  parseDictationSettings,
  pickEngine,
  pickRecordingMimeType,
  recordingExtension,
  whisperLanguage,
} from './dictation';

/*
 * The dictation contract: every failure has a message, no engine leaves the button unusable,
 * and a locale survives the trip to two different services.
 */
describe('dictation settings', () => {
  it('falls back per field instead of discarding a partly valid object', () => {
    const parsed = parseDictationSettings({ language: 'en-GB', enabled: 'yes', serverFallback: false });

    expect(parsed.language).toBe('en-GB');
    expect(parsed.enabled).toBe(DEFAULT_DICTATION_SETTINGS.enabled);
    expect(parsed.serverFallback).toBe(false);
  });

  it('survives corrupt JSON without disabling dictation', () => {
    expect(parseDictationSettings('{not json')).toEqual(DEFAULT_DICTATION_SETTINGS);
  });

  it('rejects a language the services do not offer', () => {
    expect(isDictationLanguage('fr-FR')).toBe(true);
    expect(isDictationLanguage('xx-YY')).toBe(false);
    expect(parseDictationSettings({ language: 'xx-YY' }).language).toBe(DEFAULT_DICTATION_SETTINGS.language);
  });

  it('cycles through every language and wraps', () => {
    const last = DICTATION_LANGUAGES[DICTATION_LANGUAGES.length - 1].value;

    expect(nextDictationLanguage('fr-FR')).toBe(DICTATION_LANGUAGES[1].value);
    expect(nextDictationLanguage(last)).toBe(DICTATION_LANGUAGES[0].value);
  });
});

describe('dictation messages', () => {
  it('has a user-facing sentence for every code a failure can produce', () => {
    /*
     * A missing entry would render an empty status line: the bug this contract exists to
     * prevent. Checked against the union by iterating the mapper's whole output space.
     */
    const rawErrors = [
      'not-allowed',
      'service-not-allowed',
      'audio-capture',
      'network',
      'no-speech',
      'language-not-supported',
      'something-new',
    ];

    for (const code of rawErrors.map(mapSpeechError)) {
      expect(describeDictationError(code).length).toBeGreaterThan(10);
    }

    for (const status of [400, 401, 403, 413, 429, 500, 502, 0]) {
      expect(describeDictationError(mapTranscribeFailure(status, {}))).not.toBe(describeDictationError('unknown'));
    }
  });

  it('maps a refused microphone to a permission message, not a generic one', () => {
    expect(mapSpeechError('not-allowed')).toBe('permission-denied');
    expect(mapSpeechError('audio-capture')).toBe('no-microphone');
    expect(mapSpeechError('network')).toBe('network');
  });

  it('honours the server code over the HTTP status when both are present', () => {
    expect(mapTranscribeFailure(500, { code: 'too-long' })).toBe('too-long');
    expect(mapTranscribeFailure(503, { code: 'key-missing' })).toBe('key-missing');
    expect(mapTranscribeFailure(429, {})).toBe('quota');
    expect(mapTranscribeFailure(413, {})).toBe('too-long');
  });
});

describe('dictation engines', () => {
  it('prefers the browser engine and falls back to the server when the API is absent', () => {
    expect(pickEngine({ hasSpeechRecognition: true, hasMediaRecorder: true, hasUserMedia: true })).toBe('browser');
    expect(pickEngine({ hasSpeechRecognition: false, hasMediaRecorder: true, hasUserMedia: true })).toBe('server');
  });

  it('reports no engine when neither one can work', () => {
    expect(pickEngine({ hasSpeechRecognition: false, hasMediaRecorder: false, hasUserMedia: true })).toBeNull();
    expect(pickEngine({ hasSpeechRecognition: false, hasMediaRecorder: true, hasUserMedia: false })).toBeNull();
  });

  it('records in the first container the browser and the services both accept', () => {
    expect(pickRecordingMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecordingMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecordingMimeType(() => false)).toBe('');
  });

  it('names the file so the provider can infer the container', () => {
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
  });
});

describe('dictation transcript bounds', () => {
  it('caps the transcript and says it did', () => {
    const long = 'a'.repeat(MAX_TRANSCRIPT_CHARS + 50);
    const bounded = boundTranscript(long);

    expect(bounded.text).toHaveLength(MAX_TRANSCRIPT_CHARS);
    expect(bounded.truncated).toBe(true);
  });

  it('leaves a normal transcript untouched', () => {
    expect(boundTranscript('bonjour')).toEqual({ text: 'bonjour', truncated: false });
  });
});

describe('dictation locale shapes', () => {
  it('sends the full locale to the recogniser and the base language to Whisper', () => {
    expect(whisperLanguage('fr-FR')).toBe('fr');
    expect(whisperLanguage('zh-CN')).toBe('zh');
    expect(languageBadge('fr-FR')).toBe('FR');
  });
});
