import { validateGeneratedHtml } from './generate';
import { WORK_DIR } from '~/utils/constants';

/*
 * What makes generated markup DANGEROUS once it lands in a project we then run.
 *
 * A `<script src="...">` is not, on its own, in that class: the pipeline emits
 * `<script src="https://cdn.tailwindcss.com">` on essentially every HTML+Tailwind
 * generation, so rejecting every `<script>` made the import fail 100% of the time on the
 * default stack. Dangerous shapes are the ones that execute code we cannot review: inline
 * script bodies, event handlers, `javascript:` URLs and active embeds.
 *
 * Inline scripts are not all equal either. Every HTML+Tailwind variant carries ONE inline script
 * whose whole body is `tailwind.config = { theme: { extend: { colors: ..., fontFamily: ... } } }`.
 * Refusing it (as this gate did) imported the markup but silently dropped the palette and the
 * fonts, so the imported page no longer looked like the variant the user picked. A pure assignment
 * of a JSON-ish object literal is CONFIGURATION, not code: it is read out and re-emitted as an
 * inert `<script type="application/json">` block, which no browser executes.
 */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ANY_SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>/gi;

const ACTIVE_MARKUP =
  /\bon[a-z]+(?:\s*)=|(?:\bjavascript:|\bdata:text\/html|\bexpression\s*\()|<(?:iframe|object|embed|base|form|applet)\b/i;

/*
 * `tailwind.config = { ... }` and nothing else. Anything with a statement, a call, a property access
 * on window/document, or a second `;` does not match, so it stays a hard failure.
 */
const TAILWIND_CONFIG_ASSIGNMENT = /^\s*tailwind\.config\s*=\s*(\{[\s\S]*\})\s*;?\s*$/i;

const GENERATED_PATH = `${WORK_DIR}/screenshot-generated.html`;

type Project = {
  files: { get: () => Record<string, { type: 'file' | 'folder' } | undefined> };
  queueProjectMutation: <T>(callback: () => Promise<T>) => Promise<T>;
  createFile: (path: string, content: string) => Promise<boolean>;
  showWorkbench: { set: (visible: boolean) => void };
  setSelectedFile: (path: string) => void;
};

/**
 * Turn an inline `tailwind.config = {...}` assignment into inert JSON.
 *
 * Returns undefined when the body is anything more than that assignment (a function call, a DOM
 * access, an event listener...), which keeps the "inline script is a hard failure" rule for real code.
 */
export function extractTailwindConfig(body: string): string | undefined {
  const match = TAILWIND_CONFIG_ASSIGNMENT.exec(body);

  if (!match) {
    return undefined;
  }

  const literal = match[1];

  /*
   * The object literal is JavaScript, not JSON: keys are unquoted and strings use single quotes. It is
   * normalised mechanically (no eval, no Function), because any construct that cannot be normalised
   * textually is exactly the kind we must refuse.
   */
  if (/`|\b(?:function|=>|new\s|window|document|eval|import|require)\b/.test(literal)) {
    return undefined;
  }

  const json = literal
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[{,\s])\/\/[^\n]*/g, '$1')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_all, inner: string) => `"${inner.replace(/\\'/g, "'")}"`)
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/**
 * Sanitise generated HTML into something a project can hold.
 *
 * Inline scripts are replaced (never blind-stripped) so their configuration survives; anything else
 * that could execute is a hard failure. External scripts are dropped: the page keeps its markup and
 * classes, and nothing remote runs inside the project.
 */
export function validateImportableHtml(code: string): string {
  const html = validateGeneratedHtml(code);

  let config: string | undefined;

  INLINE_SCRIPT.lastIndex = 0;

  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const extracted = extractTailwindConfig(match[2]);

    if (!extracted) {
      throw new Error(
        'Generated HTML contains an inline script. Review the source and remove it before importing into Bolt.',
      );
    }

    /* Two different configs in one page is not something we can merge honestly. */
    if (config && config !== extracted) {
      throw new Error('Generated HTML carries two different Tailwind configs. Nothing was imported.');
    }

    config = extracted;
  }

  if (ACTIVE_MARKUP.test(html.replace(INLINE_SCRIPT, ''))) {
    throw new Error(
      'Generated HTML contains active content. Review the source and remove scripts before importing into Bolt.',
    );
  }

  let clean = html.replace(INLINE_SCRIPT, '').replace(ANY_SCRIPT, '');

  if (config) {
    /*
     * Re-injected as `application/json`: it is data, so no browser executes it, while the colours and
     * fonts stay readable in the file (and can be ported to `tailwind.config.js` by the user).
     */
    clean = clean.replace(
      /<\/head\s*>/i,
      `  <script type="application/json" data-tailwind-config>${config}</script>\n</head>`,
    );
  }

  return clean;
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
