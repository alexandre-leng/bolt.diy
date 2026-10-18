import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FilesStore as FilesStoreType } from './files';

let filesStoreClass: typeof FilesStoreType;

beforeAll(async () => {
  ({ FilesStore: filesStoreClass } = await import('./files'));
});

function container(extra: Record<string, unknown> = {}) {
  return {
    workdir: '/home/project',
    internal: { watchPaths: vi.fn() },
    fs: {
      readdir: vi.fn().mockResolvedValue(['node_modules', 'src', 'package.json']),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rm: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn(),
    },
    ...extra,
  };
}

/*
 * Opening another chat resets the workbench. With WebContainer the working directory is emptied
 * (it lives in the tab). With the server runtime each conversation keeps its directory on the
 * Bolt host: emptying it deleted node_modules and forced a 4-minute reinstall on every reopen.
 */
describe('FilesStore.reset', () => {
  it('empties the working directory of a browser WebContainer', async () => {
    const wc = container();
    const store = new filesStoreClass(Promise.resolve(wc as never));

    await store.reset();

    expect(wc.fs.rm).toHaveBeenCalledWith('node_modules', { recursive: true });
    expect(wc.fs.rm).toHaveBeenCalledTimes(3);
  });

  it('moves a server sandbox to the page project instead, deleting nothing', async () => {
    const followLocation = vi.fn().mockResolvedValue(undefined);
    const wc = container({ followLocation });
    const store = new filesStoreClass(Promise.resolve(wc as never));

    await store.reset();

    expect(followLocation).toHaveBeenCalledTimes(1);
    expect(wc.fs.rm).not.toHaveBeenCalled();
  });
});
