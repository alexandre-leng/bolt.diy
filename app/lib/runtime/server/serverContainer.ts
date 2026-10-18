import type { RuntimeSocket } from './client';
import type { EventMessage, WatchEventWire } from './protocol';
import { WORKDIR } from './protocol';

/*
 * A drop-in for the subset of the StackBlitz `WebContainer` object Bolt uses, backed by a
 * gVisor sandbox on the Bolt host (bolt-runtime). Every consumer keeps calling
 * `webcontainer.fs.*`, `spawn`, `on(...)`, `internal.watchPaths` unchanged.
 */

type Unsubscribe = () => void;

export interface ServerDirEnt {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface ServerProcess {
  exit: Promise<number>;
  input: WritableStream<string>;
  output: ReadableStream<string>;
  stdout: ReadableStream<string>;
  stderr: ReadableStream<string>;
  kill(): void;
  resize(dimensions: { cols: number; rows: number }): void;
}

export interface ServerWatchEvent {
  type: WatchEventWire['type'];
  path: string;
  mtime: number;
  ino: number;
  buffer?: Uint8Array;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  const chunk = 0x8000;

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }

  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodingOf(options: unknown): string | null {
  if (typeof options === 'string') {
    return options;
  }

  if (options && typeof options === 'object' && 'encoding' in options) {
    const encoding = (options as { encoding?: unknown }).encoding;
    return typeof encoding === 'string' ? encoding : null;
  }

  return null;
}

type EventName = 'server-ready' | 'port' | 'preview-message' | 'error';

export class ServerContainer {
  readonly workdir = WORKDIR;
  readonly fs: {
    readFile(path: string, encoding?: unknown): Promise<any>;
    writeFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<any>;
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
    readdir(path: string, options?: unknown): Promise<any>;
  };
  readonly internal: {
    watchPaths(
      options: { include?: string[]; exclude?: string[]; includeContent?: boolean },
      cb: (events: ServerWatchEvent[]) => void,
    ): Unsubscribe;
  };

  #socket: RuntimeSocket;
  #listeners = new Map<EventName, Set<(...args: any[]) => void>>();
  #processes = new Map<string, { push(text: string): void; exit(code: number): void }>();

  // Output or exit that arrived before spawn() registered its pid (kept until it does).
  #early = new Map<string, Array<{ text?: string; code?: number }>>();
  #watchers = new Map<string, (events: ServerWatchEvent[]) => void>();
  #nextWatch = 1;

  constructor(socket: RuntimeSocket) {
    this.#socket = socket;
    socket.onEvent((event) => this.#onEvent(event));

    this.fs = {
      readFile: async (path, encoding) => {
        const wanted = encodingOf(encoding);

        const result = await socket.request<string | { b64: string }>('fs.readFile', {
          path,
          encoding: wanted === 'utf8' || wanted === 'utf-8' ? 'utf8' : undefined,
        });

        return typeof result === 'string' ? result : base64ToBytes(result.b64);
      },
      writeFile: async (path, data) => {
        await socket.request('fs.writeFile', {
          path,
          data: typeof data === 'string' ? data : { b64: bytesToBase64(data) },
        });
      },
      mkdir: async (path, options) => {
        await socket.request('fs.mkdir', { path, recursive: Boolean(options?.recursive) });
        return undefined;
      },
      rm: async (path, options) => {
        await socket.request('fs.rm', { path, recursive: Boolean(options?.recursive), force: Boolean(options?.force) });
      },
      readdir: async (path, options) => {
        const withFileTypes = Boolean(
          options && typeof options === 'object' && (options as { withFileTypes?: boolean }).withFileTypes,
        );

        const entries = await socket.request<Array<string | { name: string; dir: boolean; file: boolean }>>(
          'fs.readdir',
          {
            path,
            withFileTypes,
          },
        );

        if (!withFileTypes) {
          return entries as string[];
        }

        return (entries as Array<{ name: string; dir: boolean; file: boolean }>).map((entry): ServerDirEnt => ({
          name: entry.name,
          isDirectory: () => entry.dir,
          isFile: () => entry.file,
        }));
      },
    };

    this.internal = {
      watchPaths: (options, cb) => {
        const watchId = `w${this.#nextWatch++}`;
        this.#watchers.set(watchId, cb);
        void socket
          .request('watch.start', {
            watchId,
            exclude: options.exclude ?? [],
            includeContent: Boolean(options.includeContent),
          })
          .catch((error) => console.warn('[runtime] watch failed', error));

        return () => {
          this.#watchers.delete(watchId);
          void socket.request('watch.stop', { watchId }).catch(() => undefined);
        };
      },
    };
  }

  /** Which project the page is on now (set by boot: derived from the URL). */
  projectResolver: (() => string) | null = null;

  /** Called after the draft took a conversation's id (boot forgets the stored draft). */
  onDraftAdopted: (() => void) | null = null;

  #following: Promise<unknown> = Promise.resolve();

  /**
   * Bring the sandbox to the project of the current page. Serialized: a chat switch and the URL
   * watcher can both ask at once. Used instead of emptying the working directory.
   */
  followLocation(): Promise<void> {
    const run = this.#following.then(async () => {
      const target = this.projectResolver?.();

      if (!target) {
        return;
      }

      const outcome = await this.#socket.switchProject(target);

      if (outcome === 'renamed') {
        this.onDraftAdopted?.();
      }
    });

    this.#following = run.catch(() => undefined);

    return run;
  }

  on(event: EventName, listener: (...args: any[]) => void): Unsubscribe {
    let set = this.#listeners.get(event);

    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }

    set.add(listener);

    return () => set!.delete(listener);
  }

  /** Re-emit a message the preview's bridge script posted (uncaught errors in the project). */
  emitPreviewMessage(message: unknown): void {
    this.#emit('preview-message', message);
  }

  async setPreviewScript(script: string): Promise<void> {
    await this.#socket.request('preview.setScript', { script });
  }

  async spawn(
    command: string,
    argsOrOptions?: string[] | Record<string, unknown>,
    maybeOptions?: Record<string, unknown>,
  ): Promise<ServerProcess> {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    const options = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) ?? {};
    const terminal = options.terminal as { cols: number; rows: number } | undefined;

    let controller!: ReadableStreamDefaultController<string>;
    let resolveExit!: (code: number) => void;

    const exit = new Promise<number>((resolve) => (resolveExit = resolve));

    let ended = false;

    const output = new ReadableStream<string>({
      start: (c) => {
        controller = c;
      },
    });

    const pid = await this.#socket.request<string>('proc.spawn', {
      command,
      args,
      terminal,
      env: options.env,
      cwd: typeof options.cwd === 'string' ? options.cwd : undefined,
    });

    this.#processes.set(pid, {
      push: (text) => {
        if (!ended) {
          controller.enqueue(text);
        }
      },
      exit: (code) => {
        if (!ended) {
          ended = true;

          try {
            controller.close();
          } catch {
            // already closed
          }
        }

        this.#processes.delete(pid);
        resolveExit(code);
      },
    });

    const early = this.#early.get(pid) ?? [];
    this.#early.delete(pid);

    for (const item of early) {
      if (item.text !== undefined) {
        this.#processes.get(pid)?.push(item.text);
      } else if (item.code !== undefined) {
        this.#processes.get(pid)?.exit(item.code);
      }
    }

    const input = new WritableStream<string>({
      write: async (data) => {
        await this.#socket.request('proc.write', { pid, data });
      },
    });

    const [outA, outB] = output.tee();

    return {
      exit,
      input,
      output: outA,
      stdout: outB,
      stderr: new ReadableStream<string>({ start: (c) => c.close() }),
      kill: () => {
        void this.#socket.request('proc.kill', { pid }).catch(() => undefined);
      },
      resize: ({ cols, rows }) => {
        if (terminal) {
          void this.#socket.request('proc.resize', { pid, cols, rows }).catch(() => undefined);
        }
      },
    };
  }

  #emit(event: EventName, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[runtime] ${event} listener failed`, error);
      }
    }
  }

  #onEvent(event: EventMessage): void {
    switch (event.ev) {
      case 'proc.out':
      case 'proc.exit': {
        const target = this.#processes.get(event.pid);

        if (target) {
          if (event.ev === 'proc.out') {
            target.push(event.data);
          } else {
            target.exit(event.code);
          }
        } else {
          const list = this.#early.get(event.pid) ?? [];
          list.push(event.ev === 'proc.out' ? { text: event.data } : { code: event.code });
          this.#early.set(event.pid, list.slice(-2000));
        }

        break;
      }
      case 'port':
        this.#emit('port', event.port, event.type, event.url);
        break;
      case 'server-ready':
        this.#emit('server-ready', event.port, event.url);
        break;
      case 'watch': {
        const cb = this.#watchers.get(event.watchId);

        if (cb) {
          cb(
            event.events.map((wire) => ({
              type: wire.type,
              path: wire.path,
              mtime: Date.now(),
              ino: 0,
              buffer: wire.buffer ? base64ToBytes(wire.buffer.b64) : undefined,
            })),
          );
        }

        break;
      }
      case 'session.state':
        if (event.state === 'error') {
          this.#emit('error', { message: event.message ?? 'runtime error' });
        }

        break;
    }
  }
}
