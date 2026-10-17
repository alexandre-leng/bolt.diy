/**
 * Key rotation for the OpenCode Go provider.
 *
 * When a key is out of quota (429) or refused (401), the same request is replayed with the
 * next configured key. Only the server's own keys are rotated: a key the client supplied is
 * never sent to a rotated host (see `resolved.clientBaseUrl` in opencode-go.ts).
 *
 * The healthy key is remembered, so an exhausted key is not re-tried first on every request.
 * Without that memory the "rotation" only ever worked forwards and cost one wasted round-trip
 * per call for as long as the first key stayed exhausted.
 *
 * Kept pure (no I/O) so the decision can be tested without a network: `keyFallbackFetch`
 * takes the transport as a parameter.
 */

/** Statuses for which trying another key can help. Anything else is returned as-is. */
export const ROTATE_ON_STATUS: ReadonlySet<number> = new Set([401, 429]);

/** How long a key stays benched after it refused, before it is worth trying again. */
export const BENCH_MS = 5 * 60 * 1000;

/** Ordered list of distinct, non-empty keys: primary first, then the backups. */
export function orderedKeys(env: Record<string, string | undefined>): string[] {
  const names = ['OPENCODE_GO_API_KEY', 'OPENCODE_GO_API_KEY_2', 'OPENCODE_GO_API_KEY_3'];
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const name of names) {
    const value = (env[name] || '').trim();

    if (value && !seen.has(value)) {
      seen.add(value);
      keys.push(value);
    }
  }

  return keys;
}

/**
 * Tracks which keys are currently exhausted, per key list.
 *
 * Process-wide on purpose: the quota belongs to the key, not to one request, so every
 * concurrent request must see the same benched key. Keys are remembered, not dropped, and
 * the bench expires on its own — a key that ran out today is expected to work later.
 */
export class KeyHealth {
  private _benched = new Map<string, number>();

  constructor(private _now: () => number = Date.now) {}

  /** Keys worth trying, starting with the last known-good one. */
  order(keys: string[]): string[] {
    const now = this._now();

    const usable = keys.filter((key) => {
      const until = this._benched.get(key);

      return until === undefined || until <= now;
    });

    // Everything is benched: try them all anyway rather than refuse to call.
    return usable.length > 0 ? usable : keys;
  }

  /** Records a refusal so the next request starts with another key. */
  bench(key: string): void {
    this._benched.set(key, this._now() + BENCH_MS);
  }

  /** A key just worked: nothing to bench, and it becomes first. */
  promote(key: string, keys: string[]): void {
    this._benched.delete(key);

    const index = keys.indexOf(key);

    if (index > 0) {
      keys.splice(index, 1);
      keys.unshift(key);
    }
  }

  isBenched(key: string): boolean {
    const until = this._benched.get(key);

    return until !== undefined && until > this._now();
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Returns a fetch that sends with each usable key in turn until one answers.
 *
 * The body is replayed from a buffered copy, so the request can be sent again; a streamed
 * body that cannot be rewound is not rotated (the first key's response is returned).
 */
export function keyFallbackFetch(keys: string[], transport: FetchLike, health = new KeyHealth()): FetchLike {
  return async (input, init) => {
    const order = health.order(keys);

    if (order.length <= 1) {
      return transport(input, withAuth(init, order[0]));
    }

    /*
     * Only a body that can be sent twice is rotated. A ReadableStream is consumed by the
     * first send, so replaying it would send an empty or broken request.
     */
    const replayable =
      init?.body === undefined ||
      init.body === null ||
      typeof init.body === 'string' ||
      init.body instanceof Uint8Array;

    let last: Response | undefined;

    for (const key of order) {
      const response = await transport(input, withAuth(init, key));

      if (!ROTATE_ON_STATUS.has(response.status) || !replayable) {
        if (!ROTATE_ON_STATUS.has(response.status)) {
          health.promote(key, keys);
        }

        return response;
      }

      // Out of quota or refused: bench it so the next call starts elsewhere.
      health.bench(key);
      last = response;
    }

    // Every key was rotated: surface the last answer, not a made-up one.
    return last as Response;
  };
}

/** Replaces the credential header for the protocol in use, leaving every other header untouched. */
function withAuth(init: RequestInit | undefined, key: string): RequestInit {
  const headers = new Headers(init?.headers);

  // OpenAI-style (Bearer) and Anthropic-style (x-api-key) requests both reach this fetch.
  if (headers.has('x-api-key')) {
    headers.set('x-api-key', key);
  } else {
    headers.set('Authorization', `Bearer ${key}`);
  }

  return { ...init, headers };
}
