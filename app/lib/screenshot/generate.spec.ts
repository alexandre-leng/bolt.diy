import { describe, expect, it, vi } from 'vitest';
import { generateScreenshotCode, validateGeneratedHtml } from './generate';

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

function start(onProgress = vi.fn()) {
  const task = generateScreenshotCode(image, { connect, location, onProgress });
  const socket = FakeSocket.latest;
  socket.emit('open');

  return { task, socket, onProgress };
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
    await expect(task).resolves.toBe(html);
  });

  it('never returns partial code on chunks, setCode, or a clean close without variantComplete', async () => {
    const { task, socket, onProgress } = start();
    socket.message({ type: 'status', variantIndex: 0, value: 'Generating code...' });
    socket.message({ type: 'chunk', variantIndex: 0, value: '<html>' });
    socket.message({ type: 'setCode', variantIndex: 0, value: html });
    socket.emit('close', { code: 1000 });
    expect(onProgress).toHaveBeenCalledWith('Generating code...');
    await expect(task).rejects.toThrow(/incomplete/i);
  });

  it('accepts the first completed valid variant despite another variant failing', async () => {
    const { task, socket } = start();
    socket.message({ type: 'variantError', variantIndex: 0, value: 'provider error' });
    socket.message({ type: 'setCode', variantIndex: 1, value: html });
    socket.message({ type: 'variantComplete', variantIndex: 1 });
    socket.emit('close', { code: 1000 });
    await expect(task).resolves.toBe(html);
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
