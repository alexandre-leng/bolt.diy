import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Regression: project export must include binary files.
 *
 * `FilesStore` stores a binary file as base64 in `dirent.content` with `isBinary: true`.
 * Both `downloadZip` and `syncFiles` used to guard with `!dirent.isBinary`, so images,
 * fonts and audio were silently dropped from the exported ZIP and the synced folder, even
 * though the import path preserved them.
 *
 * JSZip and file-saver are mocked so the assertion is about the bytes handed to them, not
 * about ZIP serialisation.
 */
const zipEntries: Record<string, unknown> = {};
const folderEntries: Record<string, Record<string, unknown>> = {};
const saveAs = vi.fn();

vi.mock('jszip', () => {
  class FakeZip {
    file(path: string, contents: unknown) {
      zipEntries[path] = contents;

      return this;
    }

    folder(name: string) {
      folderEntries[name] = folderEntries[name] ?? {};

      return {
        file: (path: string, contents: unknown) => {
          folderEntries[name][path] = contents;
          zipEntries[`${name}/${path}`] = contents;
        },
        folder: (child: string) => {
          const nested = `${name}/${child}`;
          folderEntries[nested] = folderEntries[nested] ?? {};

          return {
            file: (path: string, contents: unknown) => {
              folderEntries[nested][path] = contents;
              zipEntries[`${nested}/${path}`] = contents;
            },
          };
        },
      };
    }

    async generateAsync() {
      return new Blob(['zip']);
    }
  }

  return { default: FakeZip };
});

vi.mock('file-saver', () => ({ default: { saveAs } }));

vi.mock('~/lib/persistence', async () => {
  const { atom } = await import('nanostores');

  return { description: atom('project') };
});

let workbenchStoreClass: typeof import('./workbench').WorkbenchStore;

beforeAll(async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  ({ WorkbenchStore: workbenchStoreClass } = await import('./workbench'));
});

// PNG magic bytes, stored the way FilesStore stores a binary file.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64');

function storeWithFiles() {
  const store = new workbenchStoreClass();
  store.files.set({
    '/home/project/src/App.tsx': { type: 'file', content: 'export default 1;', isBinary: false },
    '/home/project/public/logo.png': { type: 'file', content: PNG_BASE64, isBinary: true },
  } as any);

  return store;
}

describe('WorkbenchStore export includes binary files', () => {
  it('writes binary entries to the ZIP as bytes, decoding the stored base64', async () => {
    for (const key of Object.keys(zipEntries)) {
      delete zipEntries[key];
    }

    const store = storeWithFiles();
    await store.downloadZip();

    const binary = zipEntries['public/logo.png'] as Uint8Array | undefined;
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(Array.from(binary as Uint8Array)).toEqual(Array.from(PNG_BYTES));
    expect(zipEntries['src/App.tsx']).toBe('export default 1;');
    expect(saveAs).toHaveBeenCalled();
  });

  it('writes binary entries to the synced folder as bytes, decoding the stored base64', async () => {
    const writes: Array<{ path: string; contents: unknown }> = [];

    const createHandle = (prefix: string): any => ({
      getDirectoryHandle: async (name: string) => createHandle(prefix ? `${prefix}/${name}` : name),
      getFileHandle: async (name: string) => {
        const path = prefix ? `${prefix}/${name}` : name;

        return {
          createWritable: async () => ({
            write: async (contents: unknown) => {
              writes.push({ path, contents });
            },
            close: async () => undefined,
          }),
        };
      },
    });

    const store = storeWithFiles();
    const synced = await store.syncFiles(createHandle(''));

    const binary = writes.find((entry) => entry.path === 'public/logo.png');
    expect(binary).toBeDefined();
    expect(binary!.contents).toBeInstanceOf(Uint8Array);
    expect(Array.from(binary!.contents as Uint8Array)).toEqual(Array.from(PNG_BYTES));

    const text = writes.find((entry) => entry.path === 'src/App.tsx');
    expect(text!.contents).toBe('export default 1;');

    expect(synced).toContain('public/logo.png');
  });
});
