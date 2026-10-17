import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteHistory, encodeSaveBody, getHistory, listHistory, pickNewest, putHistory } from './syncClient';

/*
 * The sync client must never take the app down with it: if bolt-history is unreachable the
 * user keeps working from the IndexedDB cache. These tests pin that contract, plus the
 * conflict rule (newest timestamp wins, no field-level merge).
 */
type FetchArgs = [url: string, init?: RequestInit];

function mockFetch(handler: (...args: FetchArgs) => unknown) {
  const spy = vi.fn(handler);
  vi.stubGlobal('fetch', spy);

  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('syncClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists chats from the server', async () => {
    mockFetch(() => jsonResponse({ ok: true, chats: [{ id: 'a', timestamp: '2026-01-01T00:00:00Z' }] }));

    const result = await listHistory();

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].id).toBe('a');
  });

  it('returns an empty list when the server sends none', async () => {
    mockFetch(() => jsonResponse({ ok: true }));

    const result = await listHistory();

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('reports failure instead of throwing when the server is unreachable', async () => {
    mockFetch(() => {
      throw new Error('offline');
    });

    const result = await listHistory();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
  });

  it('reports failure on a non-OK status', async () => {
    mockFetch(() => jsonResponse({ ok: false }, 401));

    const result = await listHistory();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP 401');
  });

  it('fetches one chat and tolerates a missing payload', async () => {
    mockFetch(() => jsonResponse({ ok: true }));

    const result = await getHistory('missing');

    expect(result.ok).toBe(false);
  });

  it('encodes the id in the URL so odd ids cannot break the path', async () => {
    const spy = mockFetch(() => jsonResponse({ ok: true, chat: { id: 'a/b', messages: [] } }));

    await getHistory('a/b');

    expect(spy.mock.calls[0][0]).toBe('/api/history/a%2Fb');
  });

  it('puts a chat with a PUT so replaying it is idempotent', async () => {
    const spy = mockFetch(() => jsonResponse({ ok: true }));

    await putHistory({ id: 'a', messages: [], timestamp: '2026-01-01T00:00:00Z' });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/history/a');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string).id).toBe('a');
  });

  it('deletes a chat', async () => {
    const spy = mockFetch(() => jsonResponse({ ok: true }));

    await deleteHistory('a');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/history/a');
    expect(init.method).toBe('DELETE');
  });
});

describe('pickNewest', () => {
  it('prefers the remote copy when it is newer', () => {
    const local = { timestamp: '2026-01-01T00:00:00Z' };
    const remote = { timestamp: '2026-06-01T00:00:00Z' };

    expect(pickNewest(local, remote)).toBe('remote');
  });

  it('prefers the local copy when it is newer', () => {
    const local = { timestamp: '2026-09-01T00:00:00Z' };
    const remote = { timestamp: '2026-06-01T00:00:00Z' };

    expect(pickNewest(local, remote)).toBe('local');
  });

  it('keeps the local copy when timestamps tie, avoiding a pointless write', () => {
    const same = { timestamp: '2026-06-01T00:00:00Z' };

    expect(pickNewest(same, { ...same })).toBe('local');
  });

  it('handles one side being absent', () => {
    const local = { timestamp: '2026-01-01T00:00:00Z' };

    expect(pickNewest(local, undefined)).toBe('local');
    expect(pickNewest(undefined, local)).toBe('remote');
    expect(pickNewest(undefined, undefined)).toBe('none');
  });

  /*
   * The bug these cover: a blank record with a fresh timestamp (test fixture, half-written
   * push) used to win on date alone and wipe a real conversation on every device.
   */
  it('never lets an empty remote erase a populated local copy', () => {
    const local = { timestamp: '2026-06-01T00:00:00Z', messages: [{ role: 'user' }] };
    const remote = { timestamp: '2026-09-01T00:00:00Z', messages: [] };

    expect(pickNewest(local, remote)).toBe('local');
  });

  it('never lets an empty local erase a populated remote copy', () => {
    const local = { timestamp: '2026-09-01T00:00:00Z', messages: [] };
    const remote = { timestamp: '2026-06-01T00:00:00Z', messages: [{ role: 'user' }] };

    expect(pickNewest(local, remote)).toBe('remote');
  });

  it('still orders by timestamp when both copies carry messages', () => {
    const local = { timestamp: '2026-06-01T00:00:00Z', messages: [{ role: 'user' }] };
    const remote = { timestamp: '2026-09-01T00:00:00Z', messages: [{ role: 'user' }] };

    expect(pickNewest(local, remote)).toBe('remote');
  });

  it('falls back to timestamps when the summary shape carries no messages array', () => {
    const local = { timestamp: '2026-06-01T00:00:00Z' };
    const remote = { timestamp: '2026-09-01T00:00:00Z' };

    expect(pickNewest(local, remote)).toBe('remote');
  });

  it('treats an unparseable timestamp as oldest rather than newest', () => {
    // A corrupt timestamp must never win over a valid one and wipe newer history.
    expect(pickNewest({ timestamp: 'not-a-date' }, { timestamp: '2026-01-01T00:00:00Z' })).toBe('remote');
  });
});

/*
 * Storage optimisation: a large save is gzipped and gets a long timeout. A ~1 MB Agent
 * conversation was sent uncompressed and aborted after 8 s on a slow uplink (408 in nginx).
 */
describe('large saves', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('gzips a large body, and the server gets back the exact JSON', async () => {
    const json = JSON.stringify({ id: 'big', messages: [{ text: 'répété '.repeat(20_000) }] });
    const { body, headers } = await encodeSaveBody(json);

    expect(headers['Content-Encoding']).toBe('gzip');
    expect((body as ArrayBuffer).byteLength).toBeLessThan(json.length / 10);

    const restored = await new Response(
      new Response(body as ArrayBuffer).body!.pipeThrough(new DecompressionStream('gzip')),
    ).text();
    expect(restored).toBe(json);
  });

  it('sends a small body as plain JSON', async () => {
    const { body, headers } = await encodeSaveBody('{"id":"a"}');

    expect(headers).toEqual({});
    expect(body).toBe('{"id":"a"}');
  });

  it('falls back to plain JSON without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);

    const json = 'x'.repeat(40_000);
    const { body, headers } = await encodeSaveBody(json);

    expect(headers).toEqual({});
    expect(body).toBe(json);
  });

  it('does not abort a slow save after the 8 s read timeout', async () => {
    vi.useFakeTimers();

    let aborted = false;
    mockFetch(
      (_url: string, init?: RequestInit) =>
        new Promise((resolve) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve(jsonResponse({}, 499));
          });
          setTimeout(() => resolve(jsonResponse({ ok: true })), 20_000);
        }),
    );

    const pending = putHistory({ id: 'slow', messages: [], timestamp: '2026-01-01T00:00:00Z' });
    await vi.advanceTimersByTimeAsync(20_000);

    const result = await pending;
    vi.useRealTimers();

    expect(aborted).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('sends the gzip header with a large PUT', async () => {
    const spy = mockFetch(() => jsonResponse({ ok: true }));

    await putHistory({
      id: 'big',
      messages: [{ id: 'm', role: 'user', content: 'x'.repeat(50_000) }] as never,
      timestamp: '2026-01-01T00:00:00Z',
    });

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('gzip');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
