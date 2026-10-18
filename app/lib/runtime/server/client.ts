import type { EventMessage, RequestOp, ResponseMessage, RuntimeErrorShape } from './protocol';

/** Error thrown for a failed runtime operation; `code`/`message` mimic Node fs errors. */
export class RuntimeOperationError extends Error {
  readonly code: string;

  constructor(error: RuntimeErrorShape, op: string, path?: unknown) {
    super(
      typeof path === 'string' && error.code.startsWith('E')
        ? `${error.code}: ${error.message}${error.message.includes(path) ? '' : `, ${op} '${path}'`}`
        : `${error.code}: ${error.message}`,
    );
    this.name = 'RuntimeOperationError';
    this.code = error.code;
  }
}

type Listener = (event: EventMessage) => void;

interface Pending {
  op: string;
  path?: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface RuntimeSocketOptions {
  url: string;
  projectId: string;
  clientId: string;
  createSocket?: (url: string) => SocketLike;
  onState?: (state: 'connecting' | 'open' | 'reconnecting' | 'failed', detail?: string) => void;
}

const OPEN = 1;
const MAX_BACKOFF_MS = 10_000;

/**
 * One WebSocket to bolt-runtime, kept alive across network blips.
 *
 * Requests made while (re)connecting are queued and sent once the session is open again. A
 * reconnect re-sends `session.open` with the same client id, so the server resumes this tab's
 * processes and replays the events it buffered meanwhile.
 */
export class RuntimeSocket {
  #options: RuntimeSocketOptions;
  #socket: SocketLike | null = null;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #queue: string[] = [];
  #listeners = new Set<Listener>();
  #sessionOpen = false;
  #attempt = 0;
  #closed = false;
  #opened: Promise<void>;
  #resolveOpened!: () => void;
  #rejectOpened!: (error: Error) => void;
  #everOpened = false;

  constructor(options: RuntimeSocketOptions) {
    this.#options = options;
    this.#opened = new Promise<void>((resolve, reject) => {
      this.#resolveOpened = resolve;
      this.#rejectOpened = reject;
    });
    this.#connect();
  }

  /** Resolves when the first session.open succeeded. */
  get ready(): Promise<void> {
    return this.#opened;
  }

  get projectId(): string {
    return this.#options.projectId;
  }

  /**
   * Move this tab's sandbox to another project (chat switch, or the draft became a conversation).
   * The server keeps the terminals and swaps the project directory; later reconnects use the
   * new project id.
   */
  async switchProject(projectId: string): Promise<'same' | 'renamed' | 'switched'> {
    if (projectId === this.#options.projectId) {
      return 'same';
    }

    const { outcome } = await this.request<{ outcome: 'same' | 'renamed' | 'switched' }>('session.switch', {
      projectId,
    });
    this.#options = { ...this.#options, projectId };

    return outcome;
  }

  onEvent(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  request<T = unknown>(op: RequestOp, args: Record<string, unknown> = {}): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new RuntimeOperationError({ code: 'ESESSION', message: 'runtime closed' }, op));
    }

    const id = this.#nextId++;
    const frame = JSON.stringify({ ...args, id, op });

    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { op, path: args.path, resolve: resolve as (value: unknown) => void, reject });

      if (this.#sessionOpen && this.#socket?.readyState === OPEN) {
        this.#socket.send(frame);
      } else {
        this.#queue.push(frame);
      }
    });
  }

  close(): void {
    this.#closed = true;
    this.#socket?.close();
  }

  #connect(): void {
    if (this.#closed) {
      return;
    }

    this.#options.onState?.(this.#attempt === 0 ? 'connecting' : 'reconnecting');

    const socket = (this.#options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike))(
      this.#options.url,
    );
    this.#socket = socket;
    this.#sessionOpen = false;

    socket.onopen = () => {
      const id = this.#nextId++;

      this.#pending.set(id, {
        op: 'session.open',
        resolve: () => {
          this.#attempt = 0;
          this.#sessionOpen = true;
          this.#everOpened = true;
          this.#options.onState?.('open');
          this.#resolveOpened();

          for (const frame of this.#queue.splice(0)) {
            socket.send(frame);
          }
        },
        reject: (error) => {
          this.#options.onState?.('failed', error.message);

          if (!this.#everOpened) {
            this.#rejectOpened(error);
          }

          socket.close();
        },
      });
      socket.send(
        JSON.stringify({
          id,
          op: 'session.open',
          projectId: this.#options.projectId,
          clientId: this.#options.clientId,
        }),
      );
    };

    socket.onmessage = (event) => {
      let message: ResponseMessage | EventMessage;

      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if ('id' in message && typeof message.id === 'number') {
        const pending = this.#pending.get(message.id);

        if (!pending) {
          return;
        }

        this.#pending.delete(message.id);

        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new RuntimeOperationError(message.error, pending.op, pending.path));
        }

        return;
      }

      for (const listener of this.#listeners) {
        listener(message as EventMessage);
      }
    };

    socket.onerror = () => {
      // onclose follows and handles the retry
    };

    socket.onclose = () => {
      if (this.#socket !== socket) {
        return;
      }

      this.#sessionOpen = false;

      /*
       * Requests already sent on the dead socket will never be answered: fail them so callers do
       * not hang (queued ones are kept and sent after the reconnect).
       */
      for (const [id, pending] of [...this.#pending]) {
        if (pending.op !== 'session.open') {
          this.#pending.delete(id);
          pending.reject(
            new RuntimeOperationError({ code: 'ESESSION', message: 'connection to the runtime was lost' }, pending.op),
          );
        } else {
          this.#pending.delete(id);
        }
      }

      if (this.#closed) {
        return;
      }

      const delay = Math.min(MAX_BACKOFF_MS, 250 * 2 ** this.#attempt);
      this.#attempt++;
      setTimeout(() => this.#connect(), delay);
    };
  }
}
