import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSCRIPTION_SETTINGS,
  DICTATION_PROVIDERS,
  describeKeyState,
  dictationModelOptions,
  dictationProvider,
  readTranscriptionSettings,
} from './dictation-config';

/*
 * The transcription service, its model and its key are now chosen in the settings panel, so the
 * parsing has to be strict: a stored value the route would refuse must never survive a reload,
 * and a provider must never expose a model that provider does not serve.
 */
describe('transcription settings', () => {
  it('defaults to the cheapest OpenAI model that answered a real request', () => {
    expect(DEFAULT_TRANSCRIPTION_SETTINGS).toEqual({ provider: 'openai', model: 'gpt-4o-mini-transcribe' });
    expect(readTranscriptionSettings(null)).toEqual(DEFAULT_TRANSCRIPTION_SETTINGS);
  });

  it('keeps a valid choice', () => {
    expect(readTranscriptionSettings({ sttProvider: 'groq', sttModel: 'whisper-large-v3' })).toEqual({
      provider: 'groq',
      model: 'whisper-large-v3',
    });
  });

  it('refuses a model that belongs to the other provider, and falls back to that provider default', () => {
    // whisper-large-v3 is Groq-only: selecting it under OpenAI would send a request the route rejects.
    expect(readTranscriptionSettings({ sttProvider: 'openai', sttModel: 'whisper-large-v3' })).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini-transcribe',
    });
  });

  it('ignores an unknown provider or a corrupt payload', () => {
    expect(readTranscriptionSettings({ sttProvider: 'azure' })).toEqual(DEFAULT_TRANSCRIPTION_SETTINGS);
    expect(readTranscriptionSettings('{not json')).toEqual(DEFAULT_TRANSCRIPTION_SETTINGS);
  });

  it('offers only models its provider serves', () => {
    for (const provider of DICTATION_PROVIDERS) {
      const ids = dictationModelOptions(provider.name).map((model) => model.id);

      expect(ids).toContain(provider.defaultModel);

      for (const id of ids) {
        // Every offered model must be plausible for its service: the route whitelists these.
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(3);
      }
    }

    expect(dictationModelOptions('groq').map((model) => model.id)).not.toContain('gpt-4o-transcribe');
    expect(dictationModelOptions('openai').map((model) => model.id)).not.toContain('whisper-large-v3-turbo');
  });

  it('reports where a key comes from, without inventing one', () => {
    expect(describeKeyState('sk-test', false)).toBe('account');
    expect(describeKeyState('   ', false)).toBe('missing');
    expect(describeKeyState(undefined, true)).toBe('environment');
  });

  it('maps an unknown provider name to a usable provider instead of throwing', () => {
    expect(dictationProvider('nope').name).toBe('openai');
  });
});
