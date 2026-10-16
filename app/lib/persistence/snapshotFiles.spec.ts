import { describe, expect, it } from 'vitest';
import { snapshotFileMapEntries } from './snapshotFiles';

describe('snapshotFileMapEntries', () => {
  it('registers every restored file and folder under its absolute path', () => {
    const entries = snapshotFileMapEntries({
      '/home/project/src': { type: 'folder' },
      '/home/project/src/App.tsx': { type: 'file', content: 'app', isBinary: false },
      'public/logo.png': { type: 'file', content: 'iVBORw0KGgo=', isBinary: true },
    } as never);

    expect(entries).toEqual({
      '/home/project/src': { type: 'folder' },
      '/home/project/src/App.tsx': { type: 'file', content: 'app', isBinary: false },
      '/home/project/public/logo.png': { type: 'file', content: 'iVBORw0KGgo=', isBinary: true },
    });
  });

  it('skips empty entries and tolerates a missing snapshot', () => {
    expect(snapshotFileMapEntries({ '/home/project/a.ts': undefined } as never)).toEqual({});
    expect(snapshotFileMapEntries(undefined)).toEqual({});
  });
});
