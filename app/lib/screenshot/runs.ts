/**
 * Persistance des générations « depuis une capture d'écran ».
 *
 * Le dialogue ne gardait ses maquettes que dans son état React : fermer l'onglet, perdre la
 * connexion ou changer d'appareil détruisait une génération qui avait coûté deux minutes de
 * calcul. Chaque génération reçoit donc un identifiant côté serveur dès son démarrage, et son
 * statut est mis à jour au fil de l'eau.
 *
 * Règles tenues ici :
 *
 * - **Une panne de persistance ne casse jamais une génération.** Ce module est un journal,
 *   pas une dépendance : si le service répond mal, on continue sans lui et l'utilisateur
 *   garde son résultat à l'écran.
 * - **Les images ne transitent pas.** La base ne garde que des références courtes ; un
 *   base64 de 2,3 Mo collé dans une ligne ferait plus de dégâts que l'oubli qu'on répare.
 */

export type RunMode = 'design' | 'code';
export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface ScreenshotRun {
  id: string;
  mode: RunMode;
  prompt: string;
  model: string | null;
  status: RunStatus;
  images: string[];
  error: string | null;
}

const BASE = '/api/screenshot-runs';

/** Un identifiant opaque, non devinable : le serveur le valide de toute façon. */
export function newRunId(): string {
  const bytes = new Uint8Array(16);

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Enregistre une génération. Retourne false si le service est indisponible : l'appelant
 * continue sans persistance plutôt que d'échouer.
 */
export async function startRun(args: {
  id: string;
  mode: RunMode;
  prompt: string;
  model?: string | null;
}): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/${encodeURIComponent(args.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: args.mode,
        prompt: args.prompt.slice(0, 1500),
        model: args.model ?? null,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/** Clôt une génération. Silencieux en cas d'échec : le résultat affiché prime. */
export async function finishRun(args: {
  id: string;
  status: Exclude<RunStatus, 'running'>;
  images?: string[];
  error?: string | null;
}): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/${encodeURIComponent(args.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: args.status,
        ...(args.images ? { images: args.images } : {}),
        ...(args.error ? { error: args.error.slice(0, 500) } : {}),
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/** Les générations du compte, la plus récente d'abord. Vide en cas d'échec. */
export async function listRuns(signal?: AbortSignal): Promise<ScreenshotRun[]> {
  try {
    const response = await fetch(BASE, { signal });

    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as { runs?: unknown };
    const runs = Array.isArray(body?.runs) ? body.runs : [];

    return runs.filter(isRun);
  } catch {
    return [];
  }
}

export async function getRun(id: string, signal?: AbortSignal): Promise<ScreenshotRun | null> {
  try {
    const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, { signal });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { run?: unknown };

    return isRun(body?.run) ? body.run : null;
  } catch {
    return null;
  }
}

export async function deleteRun(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });

    return response.ok;
  } catch {
    return false;
  }
}

function isRun(value: unknown): value is ScreenshotRun {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const run = value as Partial<ScreenshotRun>;

  return (
    typeof run.id === 'string' &&
    (run.mode === 'design' || run.mode === 'code') &&
    typeof run.status === 'string' &&
    Array.isArray(run.images)
  );
}
