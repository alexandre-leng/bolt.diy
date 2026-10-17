import { describe, expect, it } from 'vitest';
import { keyFallbackFetch, orderedKeys } from './opencode-go-key-fallback';

/** A scripted transport: returns the given statuses in order and records each attempt. */
function scripted(statuses: number[]) {
  const attempts: { auth: string | null; xApiKey: string | null; body: unknown }[] = [];

  let i = 0;

  const transport = async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);

    attempts.push({
      auth: headers.get('Authorization'),
      xApiKey: headers.get('x-api-key'),
      body: init?.body,
    });

    const status = statuses[Math.min(i++, statuses.length - 1)];

    return new Response(`status ${status}`, { status });
  };

  return { transport, attempts };
}

describe('orderedKeys', () => {
  it('lists the primary key first, then the backups', () => {
    expect(
      orderedKeys({ OPENCODE_GO_API_KEY: 'k1', OPENCODE_GO_API_KEY_2: 'k2', OPENCODE_GO_API_KEY_3: 'k3' }),
    ).toEqual(['k1', 'k2', 'k3']);
  });

  it('ignores an unset or blank backup', () => {
    expect(orderedKeys({ OPENCODE_GO_API_KEY: 'k1', OPENCODE_GO_API_KEY_2: '   ' })).toEqual(['k1']);
  });

  it('drops a duplicate key so the same key is not tried twice', () => {
    expect(orderedKeys({ OPENCODE_GO_API_KEY: 'k1', OPENCODE_GO_API_KEY_2: 'k1' })).toEqual(['k1']);
  });

  it('returns nothing when no key is configured', () => {
    expect(orderedKeys({})).toEqual([]);
  });
});

describe('keyFallbackFetch', () => {
  it('uses the primary key and stops when it succeeds', async () => {
    const { transport, attempts } = scripted([200]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);

    const res = await f('https://x', { method: 'POST', headers: { Authorization: 'old' }, body: '{}' });

    expect(res.status).toBe(200);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].auth).toBe('Bearer k1');
  });

  it('switches to the backup key on 429 and returns its answer', async () => {
    const { transport, attempts } = scripted([429, 200]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);

    const res = await f('https://x', { method: 'POST', body: '{"a":1}' });

    expect(res.status).toBe(200);
    expect(attempts.map((a) => a.auth)).toEqual(['Bearer k1', 'Bearer k2']);
  });

  it('switches on 401 too (a refused key)', async () => {
    const { transport, attempts } = scripted([401, 200]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);

    const res = await f('https://x', { method: 'POST', body: '{}' });

    expect(res.status).toBe(200);
    expect(attempts).toHaveLength(2);
  });

  it('does not rotate on a server error: that is not a key problem', async () => {
    const { transport, attempts } = scripted([500, 200]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);

    const res = await f('https://x', { method: 'POST', body: '{}' });

    expect(res.status).toBe(500);
    expect(attempts).toHaveLength(1);
  });

  it('replays the same body with the backup key', async () => {
    const { transport, attempts } = scripted([429, 200]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);

    await f('https://x', { method: 'POST', body: '{"model":"deepseek"}' });

    expect(attempts.map((a) => a.body)).toEqual(['{"model":"deepseek"}', '{"model":"deepseek"}']);
  });

  it('rotates the x-api-key header for an Anthropic-style request', async () => {
    const { transport, attempts } = scripted([429, 200]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);

    await f('https://x', { method: 'POST', headers: { 'x-api-key': 'k1' }, body: '{}' });

    expect(attempts.map((a) => a.xApiKey)).toEqual(['k1', 'k2']);
  });

  it('returns the last answer when every key is rotated, without inventing one', async () => {
    const { transport, attempts } = scripted([429, 429]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);

    const res = await f('https://x', { method: 'POST', body: '{}' });

    expect(res.status).toBe(429);
    expect(attempts).toHaveLength(2);
  });

  it('does not rotate a streamed body that cannot be replayed', async () => {
    const { transport, attempts } = scripted([429, 200]);
    const f = keyFallbackFetch(['k1', 'k2'], transport);
    const stream = new ReadableStream();

    const res = await f('https://x', { method: 'POST', body: stream as unknown as BodyInit });

    expect(res.status).toBe(429);
    expect(attempts).toHaveLength(1);
  });

  it('with a single key, behaves as a plain fetch and never retries', async () => {
    const { transport, attempts } = scripted([429, 200]);
    const f = keyFallbackFetch(['k1'], transport);

    const res = await f('https://x', { method: 'POST', body: '{}' });

    expect(res.status).toBe(429);
    expect(attempts).toHaveLength(1);
  });
});
