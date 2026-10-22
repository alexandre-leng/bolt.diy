/*
 * The project runtime refused to start this tab's sandbox.
 *
 * Measured in production: once an account has 3 sandboxes running, the runtime answers the boot
 * with `EBUSY: vous avez déjà 3 projets en cours d'exécution : fermez un onglet ou attendez
 * qu'un projet se termine`. That rejection reached the page as an UNHANDLED rejection (4 times:
 * every store that awaits the shared boot without a catch) and the user saw nothing.
 *
 * This module turns it into one clear message, shown once, and swallows the duplicate
 * rejections of that same failure so none is left unhandled.
 */

export const RUNTIME_BOOT_TOAST_ID = 'runtime-boot-failure';

interface CodedError {
  code?: unknown;
  message?: unknown;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && typeof (error as CodedError).message === 'string') {
    return (error as CodedError).message as string;
  }

  return typeof error === 'string' ? error : '';
}

/*
 * The runtime's "busy" answers (bolt-runtime `manager.ts`), with the sentence the user reads.
 * Matching on the text, not only on `EBUSY`: a filesystem EBUSY from inside the sandbox is a
 * different problem and must keep surfacing as such.
 */
const BUSY_ANSWERS: { pattern: RegExp; french: (match: RegExpMatchArray, raw: string) => string }[] = [
  {
    pattern: /projets en cours d['’]ex[ée]cution/i,
    french: (_match, raw) => capitalize(raw.replace(/[.\s]+$/, '')),
  },
  {
    pattern: /capacity reached(?::\s*(\d+))?/i,
    french: (match) =>
      match[1]
        ? `Le serveur est à pleine capacité : ${match[1]} projets exécutent des commandes en ce moment`
        : 'Le serveur est à pleine capacité en ce moment',
  },
  {
    pattern: /open in another tab/i,
    french: () => 'Ce projet est déjà ouvert dans un autre onglet',
  },
  {
    pattern: /no preview address available/i,
    french: () => 'Aucune adresse d’aperçu n’est disponible pour le moment',
  },
];

function stripCode(message: string): string {
  return message.replace(/^\s*[A-Z]{3,}:\s*/, '').trim();
}

function busyAnswer(error: unknown) {
  const message = messageOf(error);
  const coded = error && typeof error === 'object' ? (error as CodedError).code : undefined;

  if (coded !== 'EBUSY' && !/^\s*EBUSY\b/.test(message)) {
    return undefined;
  }

  const raw = stripCode(message);

  for (const answer of BUSY_ANSWERS) {
    const match = raw.match(answer.pattern);

    if (match) {
      return answer.french(match, raw);
    }
  }

  return undefined;
}

/** The runtime's quota/busy answer (`EBUSY` with one of the runtime's own messages). */
export function isRuntimeCapacityError(error: unknown): boolean {
  return busyAnswer(error) !== undefined;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text;
}

/** The sentence shown to the user, in French, without the technical error code. */
export function runtimeBootMessage(error: unknown): string {
  const busy = busyAnswer(error);

  if (busy) {
    return `${busy}. Rechargez ensuite la page pour démarrer ce projet.`;
  }

  const raw = stripCode(messageOf(error)).replace(/[.\s]+$/, '');

  return raw
    ? `Le projet n’a pas pu démarrer : ${raw}. Rechargez la page pour réessayer.`
    : 'Le projet n’a pas pu démarrer. Rechargez la page pour réessayer.';
}

type Notify = (message: string) => void;

let reportedError: unknown;
let hasReported = false;

/** Show the boot failure to the user, once per page (later calls for the same failure are no-ops). */
export function reportRuntimeBootFailure(error: unknown, notify: Notify): void {
  if (hasReported) {
    return;
  }

  hasReported = true;
  reportedError = error;
  notify(runtimeBootMessage(error));
}

/** True for the boot failure already reported, or any runtime capacity error. */
export function isKnownRuntimeBootFailure(reason: unknown): boolean {
  return (hasReported && reason === reportedError) || isRuntimeCapacityError(reason);
}

/**
 * Mark the rejections of the boot failure as handled. Every consumer that awaits the shared boot
 * without a catch (stores, hooks) produces its own derived rejection of the same error; they are
 * all the one failure the user was already told about.
 */
export function installRuntimeRejectionGuard(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  notify: Notify,
) {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (!isKnownRuntimeBootFailure(event.reason)) {
      return;
    }

    event.preventDefault();
    reportRuntimeBootFailure(event.reason, notify);
  };

  target.addEventListener('unhandledrejection', onRejection as EventListener);

  return () => target.removeEventListener('unhandledrejection', onRejection as EventListener);
}

/** Test helper. */
export function resetRuntimeBootFailureForTests(): void {
  hasReported = false;
  reportedError = undefined;
}
