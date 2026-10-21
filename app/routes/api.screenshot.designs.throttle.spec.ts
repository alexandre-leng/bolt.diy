import { afterAll, describe, expect, it } from 'vitest';
import { action } from './api.screenshot.designs';

/*
 * `x-real-ip` / `x-forwarded-for` read straight off the request are client-controlled, so the
 * 8-per-10-min throttle on this PAID image endpoint was bypassed by rotating a forged
 * header — each forged value opened a fresh bucket. The key must come from
 * `getTrustedClientIP`, which trusts `x-real-ip` only when the request provably came through
 * the local proxy (`x-forwarded-proto`), and otherwise shares one bucket.
 *
 * Throttled requests must answer BEFORE any credential lookup: once a ChatGPT OAuth session
 * exists on the host the route would otherwise reach the network, and the spec would be timing
 * out instead of asserting a 429.
 */
process.env.CODEX_AUTH_PATH = '/nonexistent/codex-auth.json';

/*
 * The key must be absent for the throttled requests to reach the throttle at all: with a session
 * or a key present they would go to the network instead of answering 429.
 */
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;

afterAll(() => {
  process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

function design(headers: Record<string, string>) {
  return action({
    request: new Request('https://bolt.example/api/screenshot/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ prompt: 'a pricing page for a fintech app' }),
    }),
    context: {},
  } as never);
}

describe('/api/screenshot/designs throttle key', () => {
  it('shares one bucket when forged x-real-ip values rotate', async () => {
    const statuses: number[] = [];

    // 8 is the limit; a 9th request must be throttled no matter which forged IP it carries.
    for (let i = 0; i < 9; i++) {
      const response = await design({ 'x-real-ip': `10.0.0.${i}` });
      statuses.push(response.status);
    }

    /*
     * Before: each forged IP looked like a distinct client, so the 9 requests each got their
     * own budget and none was ever a 429. Now they share the untrusted bucket and the 9th trips.
     */
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('throttles across spoofed x-forwarded-for values too', async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 12; i++) {
      const response = await design({ 'x-forwarded-for': `203.0.113.${i}` });
      statuses.push(response.status);
    }

    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
