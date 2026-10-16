import type { FileMap } from '~/lib/stores/files';
import { WORK_DIR } from '~/utils/constants';

/**
 * The workbench file-map entries a restored snapshot must register.
 *
 * `restoreSnapshot` wrote the files into the WebContainer only; the in-memory map filled up
 * later, through the watcher. Until it did, `project_write_file` on a restored file failed
 * with "File exists on disk but is not tracked by the workbench", and an early "Publier"
 * sent an incomplete project. Registering them as they are written closes that window.
 */
export function snapshotFileMapEntries(files: FileMap | undefined, workdir: string = WORK_DIR): FileMap {
  const entries: FileMap = {};

  for (const [filePath, value] of Object.entries(files || {})) {
    if (!value) {
      continue;
    }

    const absolute = filePath.startsWith('/') ? filePath : `${workdir}/${filePath}`;
    entries[absolute.replace(/\/+$/, '')] = value;
  }

  return entries;
}
