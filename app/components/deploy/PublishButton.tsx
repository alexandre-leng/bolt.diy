import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { chatId } from '~/lib/persistence';
import { isRestoreArtifact, RESTORE_ARTIFACT_IDS } from '~/lib/persistence/restoreArtifacts';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

/*
 * "Publier" — the self-hosted answer to Lovable's Publish.
 *
 * Bolt can only hand a project to Netlify/Vercel/GitHub/GitLab, none of which are
 * configured here, so the Deploy menu was dead weight. This button sends the files
 * the workbench already holds to /api/publish, which builds the project with Vite
 * on the server and serves it as a real public URL:
 *
 *     https://<host>/container/<project-slug>/
 *
 * The URL works for anyone, without a session.
 */
type PublishState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'done'; url: string; slug: string }
  | { status: 'error'; message: string; log?: string };

/*
 * The project's name, taken from the artifact that DESCRIBES the project.
 *
 * Bolt's own synthetic restore artifacts are inserted first, so reading
 * `Object.values(artifacts)[0]` named a republished site after the restore ("Restored
 * Project & Setup", then "Restored project files"). Skip them before falling back.
 */
const NON_PROJECT_ARTIFACT_IDS = new Set<string>(RESTORE_ARTIFACT_IDS);

function projectName(): string {
  const artifacts = workbenchStore.artifacts.get();

  const fromArtifact = Object.entries(artifacts).find(
    ([id, artifact]) => !NON_PROJECT_ARTIFACT_IDS.has(id) && artifact?.title,
  )?.[1]?.title;

  const fromStorage = typeof localStorage === 'undefined' ? '' : localStorage.getItem('bolt_project_name') || '';

  return fromArtifact || fromStorage || 'mon-site';
}

type PublishResult = { ok?: boolean; url?: string; slug?: string; error?: string; log?: string };

/** French message for an HTTP failure that carried no usable JSON body. */
export function publishErrorMessage(status: number): string {
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
    return 'Session expirée : reconnectez-vous puis publiez à nouveau.';
  }

  if (status === 413) {
    return 'Projet trop volumineux pour être publié.';
  }

  if (status === 502 || status === 503 || status === 504) {
    return 'Serveur de publication indisponible, réessayez dans un instant.';
  }

  return `Échec de la publication (HTTP ${status}).`;
}

/*
 * Read the publish answer without trusting it to be JSON. nginx answers an expired session
 * (401/302), an oversized body (413) or a redeploy (502) with HTML, and `response.json()`
 * then surfaced "JSON.parse: unexpected character…" to the user.
 */
async function readPublishResponse(response: Response): Promise<PublishResult> {
  try {
    const parsed: unknown = JSON.parse(await response.text());

    if (parsed && typeof parsed === 'object') {
      return parsed as PublishResult;
    }
  } catch {
    // Not JSON (an HTML error page): fall through to the status-based message.
  }

  // A redirect that ended on an HTML page is the login page: the session expired.
  return { ok: false, error: publishErrorMessage(response.redirected ? 401 : response.status) };
}

export function PublishButton() {
  const [state, setState] = useState<PublishState>({ status: 'idle' });
  const artifacts = useStore(workbenchStore.artifacts);

  /*
   * A restore replays the snapshot through the file store, so for a moment the
   * workbench holds only the template's default files. Publishing in that window
   * built and published THAT — an empty "Start prompting to see magic happen"
   * page — under the real project's name. Report it instead.
   */
  const restoring = Object.values(artifacts).some((artifact) => isRestoreArtifact(artifact?.id) && !artifact?.closed);

  const hasFiles = Object.keys(artifacts).length > 0 && !restoring;

  const publish = async () => {
    /*
     * Captured once, before the (long) build. Read again after it, they belonged to whatever
     * conversation the user had opened meanwhile: the site built from chat A was recorded
     * under chat B's name and id.
     */
    const name = projectName();
    const ownerChatId = chatId.get();

    setState({ status: 'publishing' });

    try {
      // `workbenchStore.files` is the in-memory file map (path -> { type, content }).
      const map = workbenchStore.files.get();
      const files: Record<string, string> = {};

      /*
       * Binary entries hold base64 (images, fonts). Sent inside `files` they were written as
       * text, so every published image was a file of base64 characters. They travel apart
       * and the publish service decodes them; an untracked binary (content '') is skipped.
       */
      const binaryFiles: Record<string, string> = {};

      for (const [path, dirent] of Object.entries(map)) {
        if (dirent?.type !== 'file' || typeof dirent.content !== 'string') {
          continue;
        }

        if (dirent.isBinary) {
          if (dirent.content) {
            binaryFiles[path] = dirent.content;
          }
        } else {
          files[path] = dirent.content;
        }
      }

      if (!Object.keys(files).length) {
        setState({ status: 'error', message: 'Aucun fichier à publier : lance d’abord une génération.' });

        return;
      }

      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, files, binaryFiles }),
      });

      const result = await readPublishResponse(response);

      if (!response.ok || !result.ok) {
        setState({
          status: 'error',
          message: result.error || publishErrorMessage(response.status),
          log: result.log,
        });

        return;
      }

      /*
       * Record the project against the signed-in account.
       *
       * Publishing built the site but told nobody: `/projects` stayed empty, so the
       * project never appeared in the account's own list and could not be traced back to
       * the conversation that produced it. The history service already exposes
       * `PUT /api/projects/<slug>` for exactly this; call it AFTER a successful build so a
       * failed publish never leaves a "published" row pointing at a URL that 404s.
       *
       * A failure here must not fail the publish: the site is live and usable, and the
       * user cares about the URL far more than about the bookkeeping row.
       */
      if (result.slug) {
        try {
          const recorded = await fetch(`/api/projects/${encodeURIComponent(result.slug)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url: result.url, chatId: ownerChatId }),
          });

          if (!recorded.ok) {
            console.warn('publish: the site is live but could not be recorded', recorded.status);
          }
        } catch (error) {
          console.warn('publish: the site is live but could not be recorded', error);
        }
      }

      setState({ status: 'done', url: result.url || '', slug: result.slug || '' });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Erreur réseau' });
    }
  };

  const publishLabel = restoring ? 'Restauration…' : state.status === 'publishing' ? 'Publication…' : 'Publier';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="publish-button"
        onClick={publish}
        disabled={!hasFiles || state.status === 'publishing'}
        title={restoring ? 'Restauration du projet en cours…' : undefined}
        aria-label={publishLabel}
        className={classNames(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
          'bolt-primary-button hover:opacity-90',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
        )}
      >
        <span
          className={
            restoring
              ? 'i-ph:circle-notch animate-spin'
              : state.status === 'publishing'
                ? 'i-ph:circle-notch animate-spin'
                : 'i-ph:globe-hemisphere-west'
          }
          aria-hidden="true"
        />
        {/* Icon-only below `sm`: the 390 px header cannot hold every labelled control. */}
        <span className="hidden sm:inline">{publishLabel}</span>
      </button>

      {state.status === 'done' && (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          data-testid="publish-link"
          aria-label="Voir le site en ligne"
          title="Voir le site en ligne"
          className="flex shrink-0 items-center gap-1 rounded-md border border-bolt-elements-borderColor px-2.5 py-1.5 text-xs text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive"
        >
          <span className="hidden sm:inline">En ligne</span>
          <span className="i-ph:arrow-square-out" aria-hidden="true" />
        </a>
      )}

      {/*
       * Error: bounded and dismissable. A long message in this shrink-0 header group pushed
       * the title away and overflowed a phone screen, and nothing could close it.
       */}
      {state.status === 'error' && (
        <span className="flex items-center gap-1 min-w-0 max-w-[40vw]">
          {/* Phones: an icon carrying the message, the 390 px header has no room for the text. */}
          <span
            role="img"
            aria-label={state.message}
            title={state.message}
            className="sm:hidden i-ph:warning-circle shrink-0 text-base text-red-500"
          />
          <span
            data-testid="publish-error"
            className="hidden sm:block truncate text-xs text-red-500"
            title={state.log ? `${state.message}\n${state.log}` : state.message}
          >
            {state.message}
          </span>
          <button
            type="button"
            data-testid="publish-error-dismiss"
            aria-label="Fermer le message d’erreur"
            title="Fermer"
            onClick={() => setState({ status: 'idle' })}
            className="shrink-0 rounded p-0.5 text-red-500 hover:bg-bolt-elements-item-backgroundActive focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            <span className="i-ph:x text-xs" aria-hidden="true" />
          </button>
        </span>
      )}
    </div>
  );
}
