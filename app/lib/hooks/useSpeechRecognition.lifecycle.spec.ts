// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpeechRecognition } from './useSpeechRecognition';

/*
 * LK audit: server engine (Firefox: no SpeechRecognition, MediaRecorder present).
 * The microphone must not open once the user has stopped / the composer is gone.
 */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

function setup() {
  let resolveMedia!: (s: unknown) => void;

  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  (window as any).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => new Promise((r) => (resolveMedia = r))) },
  });

  return { track, stream, resolve: () => resolveMedia(stream) };
}

afterEach(() => {
  FakeRecorder.instances = [];
  delete (window as any).MediaRecorder;
});

describe('LK useSpeechRecognition server engine', () => {
  it('does not start recording when the user stopped before getUserMedia resolved', async () => {
    const media = setup();
    const { result } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));
    expect(result.current.engine).toBe('server');

    act(() => result.current.startListening());
    act(() => result.current.stopListening()); // user clicks stop while the permission prompt is open

    await act(async () => {
      media.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const recorder = FakeRecorder.instances[0];
    expect(recorder?.state ?? 'inactive').toBe('inactive');
    expect(result.current.isListening).toBe(false);
    expect(media.track.stop).toHaveBeenCalled();
  });

  it('releases the microphone when the composer unmounts during a recording', async () => {
    const media = setup();
    const { result, unmount } = renderHook(() => useSpeechRecognition({ input: '', onTranscript: vi.fn() }));

    act(() => result.current.startListening());
    await act(async () => {
      media.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeRecorder.instances[0].state).toBe('recording');

    unmount();

    expect(FakeRecorder.instances[0].state).toBe('inactive');
    expect(media.track.stop).toHaveBeenCalled();
  });
});
