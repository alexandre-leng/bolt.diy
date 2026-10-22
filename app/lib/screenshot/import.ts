import { validateGeneratedHtml } from './generate';
import { WORK_DIR } from '~/utils/constants';

/*
 * A generated Tailwind config is data, not executable code. Preserve that narrow, JSON-like
 * assignment as inert JSON while requiring explicit consent for every other active construct.
 */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ANY_SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>/gi;

const ACTIVE_MARKUP =
  /\bon[a-z]+(?:\s*)=|(?:\bjavascript:|\bdata:text\/html|\bexpression\s*\()|<(?:iframe|object|embed|base|form|applet)\b/i;

const TAILWIND_CONFIG_ASSIGNMENT = /^\s*tailwind\.config\s*=\s*(\{[\s\S]*\})\s*;?\s*$/i;
const GENERATED_PATH = `${WORK_DIR}/screenshot-generated.html`;

export type ImportOptions = {
  /** Explicit consent to store interactive source. It never permits executing it in Bolt. */
  allowScripts?: boolean;
};

type Project = {
  files: { get: () => Record<string, { type: 'file' | 'folder' } | undefined> };
  queueProjectMutation: <T>(callback: () => Promise<T>) => Promise<T>;
  createFile: (path: string, content: string) => Promise<boolean>;
  showWorkbench: { set: (visible: boolean) => void };
  currentView?: { set: (view: 'code') => void };
  projectGeneration?: { get: () => number };
  setSelectedFile: (path: string) => void;
};

/** Extract the one inert, JSON-like Tailwind assignment. Never evaluates the source. */
export function extractTailwindConfig(body: string): string | undefined {
  const match = TAILWIND_CONFIG_ASSIGNMENT.exec(body);

  if (!match) {
    return undefined;
  }

  const literal = match[1];

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

/** Generated applications may need scripts. Require explicit per-variant consent before storing them. */
export function requiresScriptConsent(code: string): boolean {
  return /<\s*script\b/i.test(code) || ACTIVE_MARKUP.test(code);
}

/** Validate HTML, retaining only an inert Tailwind config unless interactive code is consented to. */
export function validateImportableHtml(code: string, options: ImportOptions = {}): string {
  const html = validateGeneratedHtml(code);

  if (options.allowScripts === true) {
    return html;
  }

  let config: string | undefined;
  INLINE_SCRIPT.lastIndex = 0;

  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const extracted = extractTailwindConfig(match[2]);

    if (!extracted) {
      throw new Error(
        'Ce code contient un inline script. Autorisez l’import du code interactif après vérification de la source.',
      );
    }

    if (config && config !== extracted) {
      throw new Error('Le code contient deux configurations Tailwind différentes. Aucun fichier n’a été importé.');
    }

    config = extracted;
  }

  const withoutInlineScripts = html.replace(INLINE_SCRIPT, '');

  if (ACTIVE_MARKUP.test(withoutInlineScripts)) {
    throw new Error(
      'Ce code contient de l’active content. Autorisez l’import du code interactif après vérification de la source.',
    );
  }

  let clean = html.replace(INLINE_SCRIPT, '').replace(ANY_SCRIPT, '');

  if (config) {
    clean = clean.replace(
      /<\/head\s*>/i,
      `  <script type="application/json" data-tailwind-config>${config}</script>\n</head>`,
    );
  }

  return clean;
}

/** Save reviewed source without starting a process or running generated scripts. */
export async function importScreenshotHtml(
  code: string,
  project: Project,
  options: ImportOptions = {},
): Promise<string> {
  const html = validateImportableHtml(code, options);
  const generation = project.projectGeneration?.get();

  return project.queueProjectMutation(async () => {
    if (generation !== project.projectGeneration?.get()) {
      throw new Error('Le projet a changé. Relancez l’import dans le projet d’origine.');
    }

    const files = project.files.get();

    let path = GENERATED_PATH;
    let suffix = 2;

    while (files[path]) {
      path = `${WORK_DIR}/screenshot-generated-${suffix++}.html`;
    }

    if (!(await project.createFile(path, html))) {
      throw new Error('Could not save the file. Impossible de l’enregistrer dans le projet.');
    }

    project.currentView?.set('code');
    project.showWorkbench.set(true);
    project.setSelectedFile(path);

    return path;
  });
}
