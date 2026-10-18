import { describe, expect, it, vi } from 'vitest';
import { isPreviewOrigin, projectIdFor } from './boot';
import { RuntimeSocket, type SocketLike } from './client';
import { resolveRuntimeMode } from './mode';
import { base64ToBytes, bytesToBase64, ServerContainer } from './serverContainer';

/** In-memory bolt-runtime: answers requests, can push events and drop the connection. */
class FakeServer {
  sockets: FakeSocket[] = [];
  received: Array<Record<string, any>> = [];
  handlers: Record<string, (message: Record<string, any>) => unknown> = {};
  failOpen = false;

  create = (_url: string): SocketLike => {
    const socket = new FakeSocket(this);
    this.sockets.push(socket);
    queueMicrotask(() => socket.onopen?.({}));

    return socket;
  };

  get current(): FakeSocket {
    return this.sockets[this.sockets.length - 1];
  }

  push(event: Record<string, unknown>): void {
    this.current.onmessage?.({ data: JSON.stringify(event) });
  }
}

class FakeSocket implements SocketLike {
  readyState = 1;
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  onmessage: SocketLike['onmessage'] = null;

  readonly #server: FakeServer;

  constructor(server: FakeServer) {
    this.#server = server;
  }

  send(data: string): void {
    const message = JSON.parse(data);
    this.#server.received.push(message);
    queueMicrotask(() => {
      if (message.op === 'session.open' && this.#server.failOpen) {
        this.reply({ id: message.id, ok: false, error: { code: 'EBUSY', message: 'capacity reached' } });
        return;
      }

      const handler = this.#server.handlers[message.op];

      try {
        const result = handler ? handler(message) : message.op === 'session.open' ? { workdir: '/home/project' } : null;
        this.reply({ id: message.id, ok: true, result });
      } catch (error) {
        this.reply({ id: message.id, ok: false, error: error as object });
      }
    });
  }

  reply(message: object): void {
    if (this.readyState === 1) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  close(): void {
    this.drop();
  }

  drop(): void {
    if (this.readyState !== 1) {
      return;
    }

    this.readyState = 3;
    this.onclose?.({});
  }
}

function setup() {
  const server = new FakeServer();

  const socket = new RuntimeSocket({
    url: 'wss://x/api/runtime',
    projectId: 'chat-1',
    clientId: 'tab-abc-123456',
    createSocket: server.create,
  });

  return { server, socket, container: new ServerContainer(socket) };
}

describe('runtime mode', () => {
  it('follows the build default and a per-browser cookie override', () => {
    expect(resolveRuntimeMode('', undefined)).toBe('server');
    expect(resolveRuntimeMode('', 'webcontainer')).toBe('webcontainer');
    expect(resolveRuntimeMode('', 'server')).toBe('server');
    expect(resolveRuntimeMode('a=1; bolt_runtime=server', undefined)).toBe('server');
    expect(resolveRuntimeMode('bolt_runtime=wc', 'server')).toBe('webcontainer');
    expect(resolveRuntimeMode('bolt_runtime=evil', 'server')).toBe('server');
  });
});

describe('RuntimeSocket', () => {
  it('opens the session with the tab id, then sends queued requests', async () => {
    const { server, socket } = setup();
    server.handlers['fs.readFile'] = () => 'contenu';

    const pending = socket.request('fs.readFile', { path: 'a.txt', encoding: 'utf8' });
    await socket.ready;

    expect(await pending).toBe('contenu');
    expect(server.received[0]).toMatchObject({ op: 'session.open', projectId: 'chat-1', clientId: 'tab-abc-123456' });
    expect(server.received[1]).toMatchObject({ op: 'fs.readFile', path: 'a.txt' });
  });

  it('turns a server error into an fs-like error with a code', async () => {
    const { server, socket } = setup();

    server.handlers['fs.readFile'] = () => {
      throw { code: 'ENOENT', message: 'no such file or directory' };
    };
    await socket.ready;

    await expect(socket.request('fs.readFile', { path: 'missing.txt' })).rejects.toMatchObject({
      code: 'ENOENT',
      message: expect.stringContaining('ENOENT'),
    });
  });

  it('reconnects after a drop and resumes with the same tab id', async () => {
    vi.useFakeTimers();

    const { server, socket } = setup();
    await vi.runAllTimersAsync();
    await socket.ready;

    server.current.drop();
    await vi.advanceTimersByTimeAsync(300);

    expect(server.sockets).toHaveLength(2);

    const opens = server.received.filter((message) => message.op === 'session.open');
    expect(opens).toHaveLength(2);
    expect(opens[1].clientId).toBe(opens[0].clientId);

    server.handlers['fs.readdir'] = () => ['a'];
    await expect(socket.request('fs.readdir', { path: '.' })).resolves.toEqual(['a']);
    vi.useRealTimers();
  });

  it('fails the first open instead of hanging when the server refuses (capacity)', async () => {
    const server = new FakeServer();
    server.failOpen = true;

    const socket = new RuntimeSocket({
      url: 'wss://x',
      projectId: 'p',
      clientId: 'tab-abc-123456',
      createSocket: server.create,
    });
    await expect(socket.ready).rejects.toThrow('capacity reached');
    socket.close();
  });
});

describe('ServerContainer (WebContainer surface used by Bolt)', () => {
  it('fs: utf8 and binary reads, binary writes, readdir with file types', async () => {
    const { server, container } = setup();
    server.handlers['fs.readFile'] = (message) =>
      message.encoding === 'utf8' ? 'texte' : { b64: bytesToBase64(new Uint8Array([0, 1, 255])) };
    server.handlers['fs.readdir'] = (message) =>
      message.withFileTypes ? [{ name: 'src', dir: true, file: false }] : ['src'];

    expect(await container.fs.readFile('a.txt', 'utf-8')).toBe('texte');
    expect(Array.from(await container.fs.readFile('img.png'))).toEqual([0, 1, 255]);

    await container.fs.writeFile('img.png', new Uint8Array([7, 8]));
    expect(server.received.at(-1)).toMatchObject({
      op: 'fs.writeFile',
      data: { b64: bytesToBase64(new Uint8Array([7, 8])) },
    });

    const entries = await container.fs.readdir('.', { withFileTypes: true });
    expect(entries[0].name).toBe('src');
    expect(entries[0].isDirectory()).toBe(true);
    expect(await container.fs.readdir('.')).toEqual(['src']);
  });

  it('spawn: streams output, accepts input, resolves exit, even when output beats the spawn reply', async () => {
    const { server, container } = setup();

    server.handlers['proc.spawn'] = () => {
      // output and exit can arrive before the client has the pid
      queueMicrotask(() => {
        server.push({ ev: 'proc.out', pid: 'P1', data: 'bonjour ' });
      });

      return 'P1';
    };

    const process = await container.spawn('/bin/jsh', ['--osc'], { terminal: { cols: 80, rows: 24 } });
    server.push({ ev: 'proc.out', pid: 'P1', data: 'monde' });
    server.push({ ev: 'proc.exit', pid: 'P1', code: 3 });

    const reader = process.output.getReader();

    let text = '';

    for (;;) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      text += value;
    }

    expect(text).toBe('bonjour monde');
    expect(await process.exit).toBe(3);

    const writer = process.input.getWriter();
    await writer.write('ls\n');
    expect(server.received.find((message) => message.op === 'proc.write')).toMatchObject({ pid: 'P1', data: 'ls\n' });
    expect(server.received.find((message) => message.op === 'proc.spawn')).toMatchObject({
      command: '/bin/jsh',
      args: ['--osc'],
      terminal: { cols: 80, rows: 24 },
    });
  });

  it('events: port, server-ready and watch reach the same callbacks as WebContainer', async () => {
    const { server, socket, container } = setup();
    await socket.ready;

    const ready = vi.fn();
    const port = vi.fn();
    container.on('server-ready', ready);
    container.on('port', port);

    const watched = vi.fn();
    container.internal.watchPaths(
      { include: ['/home/project/**'], exclude: ['**/node_modules'], includeContent: true },
      watched,
    );
    await Promise.resolve();
    await Promise.resolve();

    const start = server.received.find((message) => message.op === 'watch.start');
    expect(start).toMatchObject({ exclude: ['**/node_modules'], includeContent: true });

    server.push({ ev: 'port', port: 5173, type: 'open', url: 'https://p1.example.test' });
    server.push({ ev: 'server-ready', port: 5173, url: 'https://p1.example.test' });
    server.push({
      ev: 'watch',
      watchId: start!.watchId,
      events: [{ type: 'add_file', path: '/home/project/a.txt', buffer: { b64: btoa('hi') } }],
    });

    expect(port).toHaveBeenCalledWith(5173, 'open', 'https://p1.example.test');
    expect(ready).toHaveBeenCalledWith(5173, 'https://p1.example.test');

    const [events] = watched.mock.calls[0];
    expect(events[0]).toMatchObject({ type: 'add_file', path: '/home/project/a.txt' });
    expect(new TextDecoder().decode(events[0].buffer)).toBe('hi');
  });

  it('base64 helpers round-trip large binary content', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('following the page to its project', () => {
  it('switches the sandbox to the conversation of the URL, once, and forgets an adopted draft', async () => {
    const { server, socket, container } = setup();
    await socket.ready;

    let path = 'chat-2';
    container.projectResolver = () => path;

    const adopted = vi.fn();
    container.onDraftAdopted = adopted;
    server.handlers['session.switch'] = (message) => ({
      outcome: message.projectId === 'chat-2' ? 'renamed' : 'switched',
    });

    await Promise.all([container.followLocation(), container.followLocation()]);

    const switches = server.received.filter((message) => message.op === 'session.switch');
    expect(switches).toHaveLength(1);
    expect(switches[0].projectId).toBe('chat-2');
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(socket.projectId).toBe('chat-2');

    path = 'chat-9';
    await container.followLocation();
    expect(
      server.received.filter((message) => message.op === 'session.switch').map((message) => message.projectId),
    ).toEqual(['chat-2', 'chat-9']);
    expect(adopted).toHaveBeenCalledTimes(1);
  });

  it('a reconnect after a switch reopens the new project', async () => {
    vi.useFakeTimers();

    const { server, socket, container } = setup();
    await vi.runAllTimersAsync();
    await socket.ready;
    container.projectResolver = () => 'chat-7';
    server.handlers['session.switch'] = () => ({ outcome: 'switched' });
    await container.followLocation();

    server.current.drop();
    await vi.advanceTimersByTimeAsync(300);

    const opens = server.received.filter((message) => message.op === 'session.open');
    expect(opens.at(-1)!.projectId).toBe('chat-7');
    vi.useRealTimers();
  });
});

describe('boot helpers', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  };

  it('maps a conversation URL to its server project, a new project to a per-tab draft', () => {
    expect(projectIdFor('/chat/2-1792160898795-0', null)).toBe('chat-2-1792160898795-0');

    const storage = memory();
    const draft = projectIdFor('/', storage);
    expect(draft).toMatch(/^draft-[A-Za-z0-9_-]{8,40}$/);
    expect(projectIdFor('/', storage)).toBe(draft);
  });

  it('never produces a project id that escapes its directory', () => {
    for (const path of ['/chat/..%2F..%2Fetc', '/chat/a%2Fb', '/chat/..', '/chat/%2E%2E']) {
      const id = projectIdFor(path, null);
      expect(id).not.toContain('/');
      expect(id).not.toContain('..');
    }
  });

  it('accepts preview messages only from sibling preview hosts', () => {
    expect(isPreviewOrigin('https://p3.169-58-18-46.sslip.io', 'bolt.169-58-18-46.sslip.io')).toBe(true);
    expect(isPreviewOrigin('https://p3.evil.example', 'bolt.169-58-18-46.sslip.io')).toBe(false);
    expect(isPreviewOrigin('https://x.169-58-18-46.sslip.io', 'bolt.169-58-18-46.sslip.io')).toBe(false);
    expect(isPreviewOrigin('http://p3.169-58-18-46.sslip.io', 'bolt.169-58-18-46.sslip.io')).toBe(false);
  });
});
