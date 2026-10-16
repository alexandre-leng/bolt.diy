import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { chatId } from '~/lib/persistence';
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
 * `restored-project-setup` is Bolt's own synthetic artifact for reopening a chat;
 * it is not the user's project, and it is inserted first, so reading
 * `Object.values(artifacts)[0]` named every republished site "Restored Project &
 * Setup". Skip it (and any other non-project artifact) before falling back.
 */
const NON_PROJECT_ARTIFACT_IDS = new Set(['restored-project-setup']);

function projectName(): string {
  const artifacts = workbenchStore.artifacts.get();

  const fromArtifact = Object.entries(artifacts).find(
    ([id, artifact]) => !NON_PROJECT_ARTIFACT_IDS.has(id) && artifact?.title,
  )?.[1]?.title;

  const fromStorage = typeof localStorage === 'undefined' ? '' : localStorage.getItem('bolt_project_name') || '';

  return fromArtifact || fromStorage || 'mon-site';
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
  const restoring = Object.values(artifacts).some(
    (artifact) => artifact?.id === 'restored-project-setup' && !artifact?.closed,
  );

  const hasFiles = Object.keys(artifacts).length > 0 && !restoring;

  const publish = async () => {
    setState({ status: 'publishing' });

    try {
      // `workbenchStore.files` is the in-memory file map (path -> { type, content }).
      const map = workbenchStore.files.get();
      const files: Record<string, string> = {};

      for (const [path, dirent] of Object.entries(map)) {
        if (dirent?.type === 'file' && typeof dirent.content === 'string') {
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
        body: JSON.stringify({ name: projectName(), files }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        url?: string;
        slug?: string;
        error?: string;
        log?: string;
      };

      if (!response.ok || !result.ok) {
        setState({ status: 'error', message: result.error || `Échec (HTTP ${response.status})`, log: result.log });

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
            body: JSON.stringify({ name: projectName(), url: result.url, chatId: chatId.get() }),
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

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="publish-button"
        onClick={publish}
        disabled={!hasFiles || state.status === 'publishing'}
        title={restoring ? 'Restauration du projet en cours…' : undefined}
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
        {restoring ? 'Restauration…' : state.status === 'publishing' ? 'Publication…' : 'Publier'}
      </button>

      {state.status === 'done' && (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          data-testid="publish-link"
          className="flex items-center gap-1 rounded-md border border-bolt-elements-borderColor px-2.5 py-1.5 text-xs text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive"
        >
          En ligne <span className="i-ph:arrow-square-out" aria-hidden="true" />
        </a>
      )}

      {state.status === 'error' && (
        <span data-testid="publish-error" className="text-xs text-red-500" title={state.log}>
          {state.message}
        </span>
      )}
    </div>
  );
}
