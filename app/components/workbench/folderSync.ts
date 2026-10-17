/*
 * "Sync Files" writes the project into a local folder through the File System Access API
 * (`window.showDirectoryPicker`). Firefox, desktop and Android, does not implement it: the
 * control was offered anyway and every attempt ended in a TypeError and "Failed to sync
 * files". The Workbench only shows the control where it can work; Export (ZIP) remains.
 */
export function canSyncToFolder(target: unknown = typeof window === 'undefined' ? undefined : window): boolean {
  return (
    typeof target === 'object' &&
    target !== null &&
    typeof (target as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}
