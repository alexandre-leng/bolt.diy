import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinTranscript, useSpeechRecognition } from './useSpeechRecognition';

/*
 * Dictation regressions (audit U9): unsupported browsers, a recognition that ends by
 * itself, the language, and dictation replacing what was typed.
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

afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
  FakeRecognition.last = undefined;
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

    act(() => FakeRecognition.last!.onend?.());
    expect(result.current.isListening).toBe(false);
  });

  it('dictates in the browser language, not the default English', () => {
    (window as any).SpeechRecognition = FakeRecognition;
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');

    renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    expect(FakeRecognition.last!.lang).toBe('fr-FR');
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
