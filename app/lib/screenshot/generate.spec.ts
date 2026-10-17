import { describe, expect, it, vi } from 'vitest';
import { generateMany, generateScreenshotCode, validateGeneratedHtml } from './generate';

class FakeSocket {
  static latest: FakeSocket;
  listeners: Record<string, Array<(event: any) => void>> = {};
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeSocket.latest = this;
  }
  addEventListener(name: string, listener: (event: any) => void) {
    (this.listeners[name] ??= []).push(listener);
  }
  send(payload: string) {
    this.sent.push(payload);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, event: unknown = {}) {
    for (const listener of this.listeners[name] ?? []) {
      listener(event);
    }
  }
  message(payload: unknown) {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

const image = 'data:image/png;base64,aGVsbG8=';
const html = '<!doctype html><html><head><title>Example</title></head><body><h1>Hello</h1></body></html>';
const connect = vi.fn((url: string) => new FakeSocket(url) as unknown as WebSocket);
const location = { protocol: 'https:', host: 'bolt.example' };

function start(onProgress = vi.fn(), onEvent = vi.fn()) {
  const task = generateScreenshotCode(image, { connect, location, onProgress, onEvent });
  const socket = FakeSocket.latest;
  socket.emit('open');

  return { task, socket, onProgress, onEvent };
}

describe('screenshot generation', () => {
  it('uses authenticated same-origin websocket and sends only screenshot protocol parameters without keys', async () => {
    const { task, socket } = start();
    expect(socket.url).toBe('wss://bolt.example/screenshot-api/generate-code');
    expect(JSON.parse(socket.sent[0])).toEqual({
      generatedCodeConfig: 'html_tailwind',
      inputMode: 'image',
      generationType: 'create',
      prompt: { text: '', images: [image], videos: [] },
      isImageGenerationEnabled: false,
      isAssetExtractionEnabled: false,
    });
    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.message({ type: 'variantComplete', variantIndex: 0 });
    socket.emit('close', { code: 1000 });
    await expect(task).resolves.toEqual([{ index: 0, code: html }]);
  });

  it('returns EVERY completed valid variant, ordered by index', async () => {
    /*
     * The backend generates 4 variants per image (NUM_VARIANTS). The previous client
     * resolved on the first completed one and discarded the rest, so the user could never
     * compare designs. All of them must come back.
     */
    const second = html.replace('Hello', 'Second');
    const third = html.replace('Hello', 'Third');
    const { task, socket } = start();

    socket.message({ type: 'variantCount', value: 3 });
    socket.message({ type: 'setCode', variantIndex: 2, value: third });
    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.message({ type: 'setCode', variantIndex: 1, value: second });
    socket.message({ type: 'variantComplete', variantIndex: 2 });
    socket.message({ type: 'variantComplete', variantIndex: 0 });
    socket.message({ type: 'variantComplete', variantIndex: 1 });
    socket.emit('close', { code: 1000 });

    await expect(task).resolves.toEqual([
      { index: 0, code: html },
      { index: 1, code: second },
      { index: 2, code: third },
    ]);
  });

  it('surfaces the rich progress frames instead of swallowing them', async () => {
    /*
     * thinking / toolStart / toolResult / assistant are what makes a multi-minute
     * generation visibly alive; the old client dropped them silently.
     */
    const { task, socket, onEvent } = start();

    socket.message({ type: 'status', value: 'Generating code...' });
    socket.message({ type: 'thinking', value: 'Considering layout' });
    socket.message({ type: 'toolStart', value: 'create_file' });
    socket.message({ type: 'toolResult', value: 'ok' });
    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.message({ type: 'variantComplete', variantIndex: 0 });
    socket.emit('close', { code: 1000 });
    await task;

    const kinds = onEvent.mock.calls.map((call: any[]) => call[0].kind);
    expect(kinds).toContain('status');
    expect(kinds).toContain('thinking');
    expect(kinds).toContain('toolStart');
    expect(kinds).toContain('toolResult');
  });

  it('sends the selected stack, input mode and design system when asked', async () => {
    const task = generateScreenshotCode(image, {
      connect,
      location,
      stack: 'react_tailwind',
      inputMode: 'image',
      generationType: 'update',
      text: 'make it blue',
      designSystem: 'Material',
    });

    const socket = FakeSocket.latest;
    socket.emit('open');

    expect(JSON.parse(socket.sent[0])).toMatchObject({
      generatedCodeConfig: 'react_tailwind',
      generationType: 'update',
      prompt: { text: 'make it blue' },
      designSystem: 'Material',
    });

    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.message({ type: 'variantComplete', variantIndex: 0 });
    socket.emit('close', { code: 1000 });
    await task;
  });

  it('accepts a text-only generation', async () => {
    // Text mode has no image, so it goes through generateMany directly.
    const task = generateMany([], {
      connect,
      location,
      inputMode: 'text',
      text: 'A pricing page with three tiers',
    });

    const socket = FakeSocket.latest;
    socket.emit('open');
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      inputMode: 'text',
      prompt: { text: 'A pricing page with three tiers' },
    });

    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.message({ type: 'variantComplete', variantIndex: 0 });
    socket.emit('close', { code: 1000 });
    await expect(task).resolves.toEqual([{ index: 0, code: html }]);
  });

  it('accepts complete code when the backend closes without a variantComplete frame', async () => {
    /*
     * The backend sends `setCode` in ONE complete message (routes/generate_code.py) and
     * always closes afterwards, but a partial run can close with valid code and no
     * variantComplete. A complete document is still a valid result, so it is accepted.
     * A fragment stays impossible: validateGeneratedHtml requires a leading <!doctype html>
     * AND a closing </html>, so truncated output is rejected below.
     */
    const { task, socket, onProgress } = start();
    socket.message({ type: 'status', variantIndex: 0, value: 'Generating code...' });
    socket.message({ type: 'chunk', variantIndex: 0, value: '<html>' });
    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.emit('close', { code: 1000 });
    expect(onProgress).toHaveBeenCalledWith('Generating code...');
    await expect(task).resolves.toEqual([{ index: 0, code: html }]);
  });

  it('never returns truncated code, even when it arrives as a complete-looking frame', async () => {
    const { task, socket } = start();
    socket.message({ type: 'setCode', variantIndex: 0, value: '<!doctype html><html><body><h1>cut' });
    socket.emit('close', { code: 1000 });
    await expect(task).rejects.toThrow(/incomplete/i);
  });

  it('accepts the first completed valid variant despite another variant failing', async () => {
    const { task, socket } = start();
    socket.message({ type: 'variantError', variantIndex: 0, value: 'provider error' });
    socket.message({ type: 'setCode', variantIndex: 1, value: html });
    socket.message({ type: 'variantComplete', variantIndex: 1 });
    socket.emit('close', { code: 1000 });
    await expect(task).resolves.toEqual([{ index: 1, code: html }]);
  });

  it('rejects server error even after one variant appears complete', async () => {
    const { task, socket } = start();
    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.message({ type: 'variantComplete', variantIndex: 0 });
    socket.message({ type: 'error', value: 'No API key configured' });
    await expect(task).rejects.toThrow('No API key configured');
  });

  it('rejects a non-document or overlarge frame before showing a result', async () => {
    const { task, socket } = start();
    socket.message({ type: 'setCode', variantIndex: 0, value: '<script>alert(1)</script>' });
    socket.message({ type: 'variantComplete', variantIndex: 0 });
    socket.emit('close', { code: 1000 });
    await expect(task).rejects.toThrow(/incomplete/i);
  });

  it('rejects malformed frames, abnormal closes, and aborts', async () => {
    const broken = start();
    broken.socket.emit('message', { data: '{bad' });
    await expect(broken.task).rejects.toThrow(/response/i);
    expect(broken.socket.closed).toBe(true);

    const disconnected = start();
    disconnected.socket.emit('close', { code: 1006 });
    await expect(disconnected.task).rejects.toThrow(/connection/i);

    const controller = new AbortController();
    const cancelled = generateScreenshotCode(image, { connect, location, signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancel/i);
    expect(FakeSocket.latest.closed).toBe(true);
  });
});

describe('generated HTML validation', () => {
  it('accepts upstream-style HTML with inline CSS, Tailwind CDN, assets and scripts for review', () => {
    const realistic =
      '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="https://cdn.example/style.css"><style>body{background:#fff}</style><script src="https://cdn.tailwindcss.com"></script></head><body><img src="https://example.org/hero.png" style="width:100%"><script>console.log("hello")</script></body></html>';
    expect(validateGeneratedHtml(realistic)).toBe(realistic);
  });

  it.each(['', '```html\n<h1>hello</h1>\n```', '<html><body><h1>unfinished'])(
    'rejects incomplete output: %s',
    (value) => expect(() => validateGeneratedHtml(value)).toThrow(),
  );
});
