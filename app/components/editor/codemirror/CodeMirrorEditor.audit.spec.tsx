// @vitest-environment jsdom
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { language } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('~/utils/fileLocks', () => ({ isFileLocked: () => ({ locked: false }), getCurrentChatId: () => undefined }));

let resolvePython!: () => void;
Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  configurable: true,
  value() {
    return undefined;
  },
});
vi.mock('./languages', () => ({
  getLanguage: (name: string) =>
    name.endsWith('.py')
      ? new Promise((resolve) => {
          resolvePython = () => resolve(python());
        })
      : Promise.resolve(javascript({ typescript: true })),
}));
import { CodeMirrorEditor } from './CodeMirrorEditor';

describe('CodeMirror file restoration accessibility', () => {
  it('ignores a late language result from an old file and does not focus on restore', async () => {
    const { container, rerender } = render(
      <>
        <button>Composer</button>
        <CodeMirrorEditor theme="dark" editable doc={{ value: 'x = 1', isBinary: false, filePath: '/a.py' }} />
      </>,
    );
    rerender(
      <>
        <button>Composer</button>
        <CodeMirrorEditor theme="dark" editable doc={{ value: 'const b = 1;', isBinary: false, filePath: '/b.ts' }} />
      </>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
    expect(view.state.facet(language)?.name).toBe('typescript');
    await act(async () => {
      resolvePython();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.state.facet(language)?.name).toBe('typescript');
    expect(document.activeElement).not.toBe(view.contentDOM);
  });

  it('starts in tab-focus mode until a user interacts with the editor', () => {
    const { container } = render(
      <CodeMirrorEditor theme="dark" editable doc={{ value: 'a', isBinary: false, filePath: '/a.ts' }} />,
    );

    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(EditorView.findFromDOM(content)!.hasFocus).toBe(false);
    content.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(EditorView.findFromDOM(content)!.state).toBeDefined();
  });
});
