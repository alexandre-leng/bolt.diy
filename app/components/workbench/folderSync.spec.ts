import { describe, expect, it } from 'vitest';
import { canSyncToFolder } from './folderSync';

/*
 * "Sync Files" needs window.showDirectoryPicker, which Firefox lacks (audit U10); the
 * Workbench renders the Sync menu only when this returns true.
 */
describe('canSyncToFolder', () => {
  it('is false without the File System Access API (Firefox)', () => {
    expect(canSyncToFolder({})).toBe(false);
    expect(canSyncToFolder(undefined)).toBe(false);
  });

  it('is true where showDirectoryPicker exists (Chromium)', () => {
    expect(canSyncToFolder({ showDirectoryPicker: () => undefined })).toBe(true);
  });

  it('defaults to false in an environment with no window', () => {
    expect(canSyncToFolder()).toBe(false);
  });
});
