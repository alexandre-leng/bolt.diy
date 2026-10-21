import { validateGeneratedHtml } from './generate';
import { WORK_DIR } from '~/utils/constants';

// Predicates must be stateless: a /g test skips every second identical import.
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/i;
const ANY_SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>/gi;

const ACTIVE_MARKUP =
  /\bon[a-z]+\s*=|\b(?:javascript:|data:text\/html|@import|expression\s*\()|<\s*(?:iframe|object|embed|base|form|applet)\b/i;

const GENERATED_PATH = `${WORK_DIR}/screenshot-generated.html`;

export type ImportOptions = {
  /** Explicit user consent to store interactive source, never permission to execute it in Bolt. */
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

/** Generated applications often need React/Babel or Vue. Never silently strip their runtime. */
export function requiresScriptConsent(code: string): boolean {
  return /<\s*script\b/i.test(code) || ACTIVE_MARKUP.test(code);
}

export function validateImportableHtml(code: string, options: ImportOptions = {}): string {
  const html = validateGeneratedHtml(code);

  /*
   * This only stores source in the isolated project. No eval, artifact, shell or preview is started.
   * The caller must present the review warning and obtain fresh consent for the selected variant.
   */
  if (options.allowScripts === true) {
    return html;
  }

  if (INLINE_SCRIPT.test(html)) {
    throw new Error(
      'Ce code contient un script inline (inline script). Autorisez l’import du code interactif après vérification de la source.',
    );
  }

  if (ACTIVE_MARKUP.test(html)) {
    throw new Error(
      'Ce code contient du contenu actif (active content). Autorisez l’import du code interactif après vérification de la source.',
    );
  }

  // Retain the legacy static-only mode for non-interactive callers.
  return html.replace(ANY_SCRIPT, '');
}

/** Save reviewed source without creating an artifact, starting a process or running generated scripts. */
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
      throw new Error('Could not create the generated HTML file. Impossible d’enregistrer le fichier dans le projet.');
    }

    project.currentView?.set('code');
    project.showWorkbench.set(true);
    project.setSelectedFile(path);

    return path;
  });
}
