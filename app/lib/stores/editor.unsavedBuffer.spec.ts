import { describe, expect, it } from 'vitest';
import { EditorStore } from './editor';
import type { FileMap } from './files';
import type { FilesStore } from './files';

/**
 * Regression: `setDocuments` rebuilds every document from the files store, which
 * changes on each AI-executed write and each container file-watcher event. The
 * old implementation always returned `value: dirent.content`, so typed-but-unsaved
 * text was silently replaced. Dirtiness is tracked by `workbenchStore.unsavedFiles`
 * (a Set of file paths), which WorkbenchStore.now passes into `setDocuments`.
 */
function file(path: string, content: string): FileMap[string] {
  return { type: 'file', content, isBinary: false } as FileMap[string];
}

function createStore() {
  const filesStore = { getFile: () => undefined } as unknown as FilesStore;

  return new EditorStore(filesStore);
}

describe('EditorStore.setDocuments', () => {
  it('keeps the in-memory buffer of a dirty document when the files store changes', () => {
    const store = createStore();

    // The file on disk.
    store.setDocuments({ '/home/project/src/App.tsx': file('/home/project/src/App.tsx', 'disk v1') });

    // The user types without saving.
    store.updateFile('/home/project/src/App.tsx', 'user typing...');

    // The files store changes (AI writes the file, or a watcher event lands).
    store.setDocuments(
      { '/home/project/src/App.tsx': file('/home/project/src/App.tsx', 'disk v2') },
      new Set(['/home/project/src/App.tsx']),
    );

    expect(store.documents.get()['/home/project/src/App.tsx'].value).toBe('user typing...');
  });

  it('adopts the files-store content for a clean document', () => {
    const store = createStore();

    store.setDocuments({ '/home/project/src/App.tsx': file('/home/project/src/App.tsx', 'disk v1') });
    store.setDocuments({ '/home/project/src/App.tsx': file('/home/project/src/App.tsx', 'disk v2') }, new Set());

    expect(store.documents.get()['/home/project/src/App.tsx'].value).toBe('disk v2');
  });

  it('preserves scroll position alongside the dirty buffer', () => {
    const store = createStore();

    store.setDocuments({ '/home/project/src/App.tsx': file('/home/project/src/App.tsx', 'disk v1') });
    store.updateFile('/home/project/src/App.tsx', 'user typing...');
    store.updateScrollPosition('/home/project/src/App.tsx', { top: 42, left: 0 });

    store.setDocuments(
      { '/home/project/src/App.tsx': file('/home/project/src/App.tsx', 'disk v2') },
      new Set(['/home/project/src/App.tsx']),
    );

    const document = store.documents.get()['/home/project/src/App.tsx'];
    expect(document.value).toBe('user typing...');
    expect(document.scroll).toEqual({ top: 42, left: 0 });
  });
});
