import { AlertTriangle, CheckCircle2, Loader2, Lock, Sparkles } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { fetchSession, type Session } from '~/lib/auth/session';
import { classNames } from '~/utils/classNames';

/*
 * "Mon accès IA": what this account may use, in words a user can act on.
 *
 * The point is NOT to reproduce the provider grid. Somebody who is not the administrator has
 * exactly one decision here (which model, when the admin left a choice), and everything else
 * is a fact to read: this provider is available, that one needs a personal key, this one is
 * closed. A locked setting shows a padlock and a sentence saying who to ask, because a field
 * that silently disappears sends the user hunting for a bug.
 *
 * This screen never receives a key. `/api/model-policy` carries the permissions only.
 */

interface PolicyPayload {
  managedMode: boolean;
  defaultModel: { provider: string; model: string };
  effortPolicy: 'free' | 'auto-only';
  allowedProviders: string[];
  allowedModels: Record<string, string[]>;
  userKeyProviders: string[];
  providers: Record<string, boolean>;
}

const EMPTY: PolicyPayload = {
  managedMode: false,
  defaultModel: { provider: '', model: '' },
  effortPolicy: 'free',
  allowedProviders: [],
  allowedModels: {},
  userKeyProviders: [],
  providers: {},
};

type State = { kind: 'open' | 'personal-key' | 'locked'; detail: string };

export function IaAccessTab() {
  const [session, setSession] = useState<Session>({ loading: true, authenticated: false, user: null });
  const [policy, setPolicy] = useState<PolicyPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    fetchSession(controller.signal).then(setSession);

    return () => controller.abort();
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/model-policy', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setPolicy((await response.json()) as PolicyPayload);
      setError('');
    } catch (cause) {
      setError(`Impossible de lire votre accès : ${cause instanceof Error ? cause.message : 'erreur réseau'}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (session.loading || (!policy && !error)) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-sm text-bolt-elements-textSecondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Chargement…
      </div>
    );
  }

  if (error && !policy) {
    return <p className="m-4 rounded-md bg-red-500/10 p-3 text-sm text-red-500">{error}</p>;
  }

  const current = policy ?? EMPTY;

  /* Without a policy every provider the app ships is usable: say so, do not show an empty list. */
  const openProviders = current.managedMode
    ? current.allowedProviders
    : [...new Set([...current.allowedProviders, ...Object.keys(current.providers), ...current.userKeyProviders])];

  const stateOf = (name: string): State => {
    const managed = current.providers[name] === true;

    if (managed) {
      return {
        kind: 'open',
        detail: 'Configuré par l’administrateur : vous n’avez aucune clé à saisir.',
      };
    }

    if (current.userKeyProviders.includes(name)) {
      return {
        kind: 'personal-key',
        detail: 'Vous pouvez utiliser votre propre clé pour ce fournisseur.',
      };
    }

    if (current.allowedProviders.includes(name) || !current.managedMode) {
      return {
        kind: 'locked',
        detail: 'Aucune clé configurée pour ce fournisseur. Demandez à l’administrateur de l’ouvrir.',
      };
    }

    return {
      kind: 'locked',
      detail: 'Fermé sur cette instance. Seul l’administrateur peut l’autoriser.',
    };
  };

  const labelFor = (name: string) => (name === '' ? 'Automatique' : name);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-bolt-elements-borderColor px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-bolt-elements-textSecondary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Mon accès IA</h2>
          <span
            className={classNames(
              'rounded px-1.5 py-0.5 text-[11px] font-medium',
              current.managedMode
                ? 'bg-accent-500/15 text-bolt-elements-textPrimary'
                : 'bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary',
            )}
          >
            {current.managedMode ? 'géré par l’administrateur' : 'configuration libre'}
          </span>
        </div>
        <p className="mt-1 text-xs text-bolt-elements-textSecondary">
          {current.managedMode
            ? 'Les modèles sont configurés pour vous. Vous choisissez parmi ceux qui sont autorisés, et vous ne manipulez aucune clé.'
            : 'Aucune restriction n’est active : les fournisseurs disponibles dépendent des clés configurées sur cette instance.'}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <dl className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3">
            <dt className="text-[11px] font-medium text-bolt-elements-textSecondary">Modèle par défaut</dt>
            <dd className="mt-0.5 text-sm text-bolt-elements-textPrimary">
              {current.defaultModel.model
                ? `${labelFor(current.defaultModel.model)} (${labelFor(current.defaultModel.provider)})`
                : 'Celui que vous choisissez dans le composer'}
            </dd>
          </div>
          <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3">
            <dt className="text-[11px] font-medium text-bolt-elements-textSecondary">Effort de raisonnement</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-bolt-elements-textPrimary">
              {current.effortPolicy === 'auto-only' ? (
                <>
                  <Lock className="h-3.5 w-3.5 text-bolt-elements-textTertiary" aria-hidden="true" />
                  Verrouillé sur automatique
                </>
              ) : (
                'Vous le réglez dans le composer'
              )}
            </dd>
          </div>
        </dl>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-bolt-elements-textSecondary">
          Fournisseurs ({openProviders.length})
        </h3>

        {openProviders.length === 0 ? (
          <p className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3 text-xs text-bolt-elements-textSecondary">
            Aucun fournisseur ne vous est ouvert. Demandez à l’administrateur d’en autoriser un.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {openProviders.map((name) => {
              const state = stateOf(name);
              const models = current.allowedModels[name] ?? [];

              return (
                <li
                  key={name}
                  data-testid={`ia-provider-${name}`}
                  className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-bolt-elements-textPrimary">{name}</span>
                    {state.kind === 'open' && (
                      <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-0.5 text-[11px] font-medium text-green-500">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        disponible
                      </span>
                    )}
                    {state.kind === 'personal-key' && (
                      <span className="rounded bg-accent-500/15 px-1.5 py-0.5 text-[11px] font-medium text-bolt-elements-textPrimary">
                        clé personnelle autorisée
                      </span>
                    )}
                    {state.kind === 'locked' && (
                      <span className="inline-flex items-center gap-1 rounded bg-bolt-elements-background-depth-2 px-1.5 py-0.5 text-[11px] text-bolt-elements-textTertiary">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        non disponible
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[11px] text-bolt-elements-textSecondary">{state.detail}</p>

                  {models.length > 0 && (
                    <div className="mt-2">
                      <span className="text-[11px] text-bolt-elements-textTertiary">
                        Modèles autorisés ({models.length})
                      </span>
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {models.map((model) => (
                          <li
                            key={model}
                            className="rounded bg-bolt-elements-background-depth-2 px-1.5 py-0.5 text-[11px] text-bolt-elements-textSecondary"
                          >
                            {model}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {session.user?.isAdmin && (
          <p className="mt-4 rounded-md bg-accent-500/10 p-2 text-[11px] text-bolt-elements-textSecondary">
            Vous êtes administrateur : la politique complète se règle dans <strong>Paramètres des modèles</strong>.
          </p>
        )}
      </div>
    </div>
  );
}
