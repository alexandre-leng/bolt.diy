import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinTranscript, useSpeechRecognition } from './useSpeechRecognition';
import { DICTATION_STORAGE_KEY } from '~/lib/dictation';

/*
 * Dictation regressions: unsupported browsers, a recognition that ends by itself, the
 * language, dictation replacing what was typed, and the two silent failures the audit found
 * (no visible error, no resume after a silence).
 */
class FakeRecognition {
  static last: FakeRecognition | undefined;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognition.last = this;
  }
}

function emitResult(text: string) {
  FakeRecognition.last!.onresult?.({ results: [[{ transcript: text }]] });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
  FakeRecognition.last = undefined;
  vi.useRealTimers();
});

describe('useSpeechRecognition', () => {
  it('reports unsupported when the API is missing (Firefox)', () => {
    const { result } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    expect(result.current.supported).toBe(false);
  });

  it('resets isListening when the engine stops by itself', () => {
    (window as any).SpeechRecognition = FakeRecognition;

    const { result } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    act(() => result.current.startListening());
    expect(result.current.isListening).toBe(true);

    act(() => result.current.stopListening());
    expect(result.current.isListening).toBe(false);
  });

  it('resumes by itself after a silence instead of leaving the user to notice', async () => {
    (window as any).SpeechRecognition = FakeRecognition;

    const { result } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    act(() => result.current.startListening());
    expect(FakeRecognition.last!.start).toHaveBeenCalledTimes(1);

    act(() => FakeRecognition.last!.onend?.());

    // The resume is delayed by design; wait for it rather than tightening the delay.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(FakeRecognition.last!.start).toHaveBeenCalledTimes(2);
  });

  it('shows a message when the microphone is refused, and does not spin on restart', async () => {
    (window as any).SpeechRecognition = FakeRecognition;

    const { result } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    act(() => result.current.startListening());
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));

    expect(result.current.error?.code).toBe('permission-denied');
    expect(result.current.errorMessage).toMatch(/micro/i);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    // A refused microphone fails the same way again: the session ends with the message.
    expect(FakeRecognition.last!.start).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on silence, which is not a failure', () => {
    (window as any).SpeechRecognition = FakeRecognition;

    const { result } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    act(() => result.current.startListening());
    act(() => FakeRecognition.last!.onerror?.({ error: 'no-speech' }));

    expect(result.current.error).toBeNull();
  });

  it('dictates in the browser language, not the default English', () => {
    (window as any).SpeechRecognition = FakeRecognition;
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');

    renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    expect(FakeRecognition.last!.lang).toBe('fr-FR');
  });

  it('uses the language chosen in settings, and applies a change while mounted', () => {
    (window as any).SpeechRecognition = FakeRecognition;
    localStorage.setItem(DICTATION_STORAGE_KEY, JSON.stringify({ language: 'en-US' }));

    const { result } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    expect(FakeRecognition.last!.lang).toBe('en-US');

    act(() => result.current.updateSettings({ language: 'de-DE' }));

    expect(FakeRecognition.last!.lang).toBe('de-DE');
    expect(JSON.parse(localStorage.getItem(DICTATION_STORAGE_KEY)!).language).toBe('de-DE');
  });

  it('appends the dictation to the text already typed', () => {
    (window as any).SpeechRecognition = FakeRecognition;

    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ input: 'Ajoute', onTranscript }));

    act(() => result.current.startListening());
    act(() => emitResult('un bouton bleu'));

    expect(onTranscript).toHaveBeenLastCalledWith('Ajoute un bouton bleu');
  });
});

describe('joinTranscript', () => {
  it('keeps exactly one space between typed text and dictation', () => {
    expect(joinTranscript('', 'bonjour')).toBe('bonjour');
    expect(joinTranscript('Salut ', 'toi')).toBe('Salut toi');
    expect(joinTranscript('Salut', 'toi')).toBe('Salut toi');
  });
});
