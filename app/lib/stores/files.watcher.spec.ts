import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FilesStore as FilesStoreType } from './files';

let filesStoreClass: typeof FilesStoreType;
let encodeBinaryContent: (buffer: Uint8Array) => string;

beforeAll(async () => {
  ({ FilesStore: filesStoreClass, encodeBinaryContent } = await import('./files'));
});

type WatchCallback = (events: unknown[]) => void;

function createStore() {
  let emit!: WatchCallback;

  const webcontainer = {
    workdir: '/home/project',
    internal: {
      watchPaths: vi.fn((_options: unknown, callback: WatchCallback) => {
        emit = callback;
      }),
    },
    fs: { readdir: vi.fn().mockResolvedValue([]), readFile: vi.fn(), writeFile: vi.fn(), rm: vi.fn(), mkdir: vi.fn() },
  };

  const store = new filesStoreClass(Promise.resolve(webcontainer as never));

  const ready = async () => {
    for (let i = 0; i < 20 && !emit; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  // The watcher batches events for 100 ms before processing them.
  const send = async (events: unknown[]) => {
    await ready();
    emit(events);
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  return { store, send };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48]);

describe('FilesStore watcher', () => {
  it('keeps a binary file as base64 instead of an empty string', async () => {
    const { store, send } = createStore();

    await send([{ type: 'add_file', path: '/home/project/public/logo.png', buffer: PNG }]);

    const entry = store.files.get()['/home/project/public/logo.png'];
    expect(entry).toMatchObject({ type: 'file', isBinary: true });
    expect(entry && entry.type === 'file' ? entry.content : null).toBe(encodeBinaryContent(PNG));
    expect(entry && entry.type === 'file' ? entry.content : '').not.toBe('');
  });

  it('removes the children of a deleted folder, and only them', async () => {
    const { store, send } = createStore();
    const text = new TextEncoder().encode('export const a = 1;\n');

    await send([
      { type: 'add_dir', path: '/home/project/src/lib' },
      { type: 'add_file', path: '/home/project/src/lib/a.ts', buffer: text },
      { type: 'add_file', path: '/home/project/src/library/b.ts', buffer: text },
    ]);
    await send([{ type: 'remove_dir', path: '/home/project/src/lib' }]);

    const files = store.files.get();
    expect(files['/home/project/src/lib/a.ts']).toBeUndefined();
    expect(files['/home/project/src/library/b.ts']).toMatchObject({ type: 'file' });
  });

  it('encodes large binaries in chunks without overflowing the call stack', () => {
    const big = new Uint8Array(200_000).fill(7);

    expect(atob(encodeBinaryContent(big)).length).toBe(big.length);
  });
});
