import { validateGeneratedHtml } from './generate';
import { WORK_DIR } from '~/utils/constants';

/*
 * What makes generated markup DANGEROUS once it lands in a project we then run.
 *
 * A `<script src="...">` is not, on its own, in that class: the pipeline emits
 * `<script src="https://cdn.tailwindcss.com">` on essentially every HTML+Tailwind
 * generation, so rejecting every `<script>` made the import fail 100% of the time on the
 * default stack. The dangerous shapes are the ones that execute code we cannot review:
 * inline script bodies, event handlers, `javascript:` URLs and active embeds. External
 * script tags are stripped from the imported output instead of aborting the whole import.
 */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/gi;
const ANY_SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>/gi;

const ACTIVE_MARKUP =
  /\bon[a-z]+\s*=|(?:javascript:|data:text\/html|@import|expression\s*\()|<\s*(?:iframe|object|embed|base|form|applet)\b/i;

/** An inline script body is code we cannot review: that is the one hard failure. */
const hasInlineScript = (html: string) => INLINE_SCRIPT.test(html);

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

  if (hasInlineScript(html)) {
    throw new Error(
      'Generated HTML contains an inline script. Review the source and remove it before importing into Bolt.',
    );
  }

  if (ACTIVE_MARKUP.test(html)) {
    throw new Error(
      'Generated HTML contains active content. Review the source and remove scripts before importing into Bolt.',
    );
  }

  /*
   * External script tags (the Tailwind CDN, a font loader) are dropped rather than
   * refused: the page keeps its markup and its classes, and nothing remote executes
   * inside the project. Without this every HTML+Tailwind generation was un-importable.
   */
  return html.replace(ANY_SCRIPT, '');
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
