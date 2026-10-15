import { describe, expect, it } from 'vitest';
import { describeChatStream, isNetworkStreamError, trackedChatFetch } from './chatStreamDiagnostics';

describe('isNetworkStreamError', () => {
  it('recognises browser network failures mid-stream', () => {
    expect(isNetworkStreamError('Error in input stream')).toBe(true); // Firefox
    expect(isNetworkStreamError('network error')).toBe(true); // Chrome
    expect(isNetworkStreamError('TypeError: Failed to fetch')).toBe(true);
    expect(isNetworkStreamError('Load failed')).toBe(true); // Safari
  });

  it('leaves provider and auth errors alone', () => {
    expect(isNetworkStreamError('Invalid or missing API key')).toBe(false);
    expect(isNetworkStreamError('Rate limit exceeded')).toBe(false);
    expect(isNetworkStreamError(undefined)).toBe(false);
  });
});

describe('trackedChatFetch', () => {
  it('passes the body through unchanged and counts bytes and timings', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('data: {"type":"start"}\n\n', { status: 200 })) as typeof fetch;

    try {
      const response = await trackedChatFetch('/api/chat', { method: 'POST' });
      const text = await response.text();

      expect(text).toBe('data: {"type":"start"}\n\n');
      expect(response.status).toBe(200);

      const d = describeChatStream();
      expect(d.status).toBe(200);
      expect(d.bytes).toBe(text.length);
      expect(d.firstByteMs).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
