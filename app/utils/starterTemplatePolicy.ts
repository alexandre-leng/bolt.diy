type Files = Record<string, { type: 'file' | 'folder' } | undefined>;

/** A starter initializes an empty project; imported files are already a project. */
export function shouldSelectStarterTemplate(enabled: boolean, files: Files): boolean {
  return enabled && !Object.values(files).some((entry) => entry?.type === 'file');
}
