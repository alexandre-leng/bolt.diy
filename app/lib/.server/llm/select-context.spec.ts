import { describe, expect, it } from 'vitest';
import { applyContextBufferUpdate } from './select-context';

const file = (content: string) => ({ type: 'file' as const, content, isBinary: false });

const files = {
  '/home/project/src/App.tsx': file('app'),
  '/home/project/src/lib/data.ts': file('data'),
  '/home/project/src/styles.css': file('css'),
};

const filePaths = Object.keys(files);

describe('applyContextBufferUpdate', () => {
  it('keeps the current context when the model asks for no change (the prompt allows an empty tag)', () => {
    // Before: zero NEW files threw "Bolt failed to select files" and failed the whole turn.
    const result = applyContextBufferUpdate({
      responseText: '<updateContextBuffer>\n</updateContextBuffer>',
      files,
      filePaths,
      currentContext: { 'src/App.tsx': files['/home/project/src/App.tsx'] },
    });

    expect(Object.keys(result)).toEqual(['src/App.tsx']);
  });

  it('keeps files already in context next to the newly included ones, minus the excluded', () => {
    const result = applyContextBufferUpdate({
      responseText:
        '<updateContextBuffer><includeFile path="src/lib/data.ts"/><excludeFile path="src/styles.css"/></updateContextBuffer>',
      files,
      filePaths,
      currentContext: {
        'src/App.tsx': files['/home/project/src/App.tsx'],
        'src/styles.css': files['/home/project/src/styles.css'],
      },
    });

    expect(Object.keys(result).sort()).toEqual(['src/App.tsx', 'src/lib/data.ts']);
  });

  it('ignores files that are not in the project and survives a malformed answer', () => {
    expect(
      applyContextBufferUpdate({
        responseText: '<updateContextBuffer><includeFile path="../../etc/passwd"/></updateContextBuffer>',
        files,
        filePaths,
        currentContext: {},
      }),
    ).toEqual({});

    expect(applyContextBufferUpdate({ responseText: 'sorry, I cannot', files, filePaths, currentContext: {} })).toEqual(
      {},
    );
  });
});
