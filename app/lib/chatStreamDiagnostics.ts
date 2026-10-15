/*
 * Client-side diagnostics for /api/chat streams.
 *
 * A reply that dies mid-stream ("Error in input stream" on Firefox,
 * "network error" on Chrome) leaves nothing in the server logs: the server
 * finished its side, the browser lost the connection. To tell a phone going
 * to sleep from a flaky network or a server problem, we record what the
 * browser saw (timings, bytes, visibility and connectivity changes) and send
 * it to /client-report, which nginx logs to /var/log/nginx/bolt-client.log.
 */

const NETWORK_STREAM_ERROR =
  /input stream|networkerror|network error|failed to fetch|load failed|terminated|network connection was lost|err_network|err_connection|err_http2/i;

export function isNetworkStreamError(message: string | undefined): boolean {
  return typeof message === 'string' && NETWORK_STREAM_ERROR.test(message);
}

interface StreamState {
  startedAt: number;
  firstByteAt?: number;
  lastByteAt?: number;
  bytes: number;
  status?: number;
}

let current: StreamState | undefined;

const events: { t: number; e: string }[] = [];

let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') {
    return;
  }

  listening = true;

  const push = (e: string) => {
    events.push({ t: Date.now(), e });
    events.splice(0, Math.max(0, events.length - 20));
  };

  document.addEventListener('visibilitychange', () => push(`visibility:${document.visibilityState}`));
  window.addEventListener('online', () => push('online'));
  window.addEventListener('offline', () => push('offline'));
  window.addEventListener('pagehide', () => push('pagehide'));
}

/** `fetch` for DefaultChatTransport: counts bytes and timings of the reply stream. */
export const trackedChatFetch: typeof fetch = async (input, init) => {
  listen();

  const state: StreamState = { startedAt: Date.now(), bytes: 0 };
  current = state;

  const response = await fetch(input, init);
  state.status = response.status;

  if (!response.body) {
    return response;
  }

  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const now = Date.now();
        state.firstByteAt ??= now;
        state.lastByteAt = now;
        state.bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );

  return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
};

export function describeChatStream(now = Date.now()) {
  const s = current;

  return {
    status: s?.status,
    bytes: s?.bytes,
    elapsedMs: s ? now - s.startedAt : undefined,
    firstByteMs: s?.firstByteAt && s ? s.firstByteAt - s.startedAt : undefined,
    silentForMs: s?.lastByteAt ? now - s.lastByteAt : undefined,
    events: s
      ? events.filter((event) => event.t >= s.startedAt).map((event) => `${event.t - s.startedAt}ms ${event.e}`)
      : [],
    online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
    visibility: typeof document === 'undefined' ? undefined : document.visibilityState,
  };
}

/** Fire-and-forget report; never throws, never blocks the UI. */
export function reportChatFailure(message: string, extra: Record<string, unknown> = {}) {
  try {
    const payload = JSON.stringify({
      message: message.slice(0, 300),
      path: location.pathname,
      ...describeChatStream(),
      ...extra,
    });
    void fetch(`/client-report?d=${encodeURIComponent(payload.slice(0, 1800))}`, { keepalive: true }).catch(
      () => undefined,
    );
  } catch {
    // diagnostics must never break the chat
  }
}
