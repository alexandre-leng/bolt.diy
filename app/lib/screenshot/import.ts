import { validateGeneratedHtml } from './generate';
import { WORK_DIR } from '~/utils/constants';

const ACTIVE_MARKUP =
  /<\s*(?:script|iframe|object|embed|base|form|svg|math|applet)\b|\bon[a-z]+\s*=|\b(?:javascript:|data:text\/html|@import|expression\s*\()/i;

const GENERATED_PATH = `${WORK_DIR}/screenshot-generated.html`;

type Project = {
  files: { get: () => Record<string, { type: 'file' | 'folder' } | undefined> };
  queueProjectMutation: <T>(callback: () => Promise<T>) => Promise<T>;
  createFile: (path: string, content: string) => Promise<boolean>;
  showWorkbench: { set: (visible: boolean) => void };
  setSelectedFile: (path: string) => void;
};

export function validateImportableHtml(code: string): string {
  const html = validateGeneratedHtml(code);

  if (ACTIVE_MARKUP.test(html)) {
    throw new Error(
      'Generated HTML contains active content. Review the source and remove scripts before importing into Bolt.',
    );
  }

  return html;
}

/** Never create an artifact or start a process from untrusted model output. */
export async function importScreenshotHtml(code: string, project: Project): Promise<string> {
  const html = validateImportableHtml(code);

  return project.queueProjectMutation(async () => {
    if (project.files.get()[GENERATED_PATH]) {
      throw new Error('screenshot-generated.html already exists. Rename it before importing another screenshot.');
    }

    if (!(await project.createFile(GENERATED_PATH, html))) {
      throw new Error('Could not create the generated HTML file.');
    }

    project.showWorkbench.set(true);
    project.setSelectedFile(GENERATED_PATH);

    return GENERATED_PATH;
  });
}
