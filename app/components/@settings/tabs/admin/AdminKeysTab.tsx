import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Select } from '~/components/ui/Select';
import { fetchSession, type Session } from '~/lib/auth/session';
import { classNames } from '~/utils/classNames';

/*
 * Instance provider keys, inside the app's own Settings panel.
 *
 * The administrator configures the model providers ONCE and every account uses those keys
 * (see app/lib/.server/api/instance-keys.ts for the resolution order). This tab is the
 * surface for it, and it exists only for an administrator: the tab itself is hidden
 * (`isAdminOnly` in the tab configuration) AND every endpoint behind it answers 403 to a
 * normal account, so hiding the tab is convenience, not the guard.
 *
 * Deliberate choices:
 *  - a stored key is never read back from the server, only masked (`sk-p…cdef`); the input
 *    starts empty, so saving cannot re-submit a value the browser never received;
 *  - "Vérifier" asks the server to make one authenticated call to the provider, because
 *    "saved" and "works" are different states and only the provider can tell them apart;
 *  - a per-provider switch opens that provider to personal keys, closed by default.
 */

interface AdminProvider {
  name: string;
  label: string;
  needsKey: boolean;
  configured: boolean;
  maskedKey: string;
  baseUrl: string;
  source: 'environment' | 'instance' | 'none';
  allowUserKeys: boolean;
}

interface AdminPayload {
  ok: boolean;
  providers: AdminProvider[];
  imageService: { providers: Array<{ name: string; configured: boolean; maskedKey: string }> };
}

type Verdict = { ok: boolean; detail: string } | null;

/**
 * The instance-wide model policy, read from and written to the accounts service.
 *
 * Kept as a separate shape from the provider grid on purpose: the grid is about KEYS (what
 * pays), the policy is about PERMISSIONS (what the others may change). Merging them into one
 * save button is how the two drifted apart in the first place.
 */
interface ModelPolicy {
  managedMode: boolean;
  defaultModel: { provider: string; model: string };
  allowedProviders: string[];
  allowedModels: Record<string, string[]>;
  effortPolicy: 'free' | 'auto-only';
}

interface PolicyPayload {
  ok: boolean;
  policy: ModelPolicy;
  providers: Array<{ name: string; label: string; needsKey: boolean }>;
  effortPolicies: string[];
}

const EMPTY_POLICY: ModelPolicy = {
  managedMode: false,
  defaultModel: { provider: '', model: '' },
  allowedProviders: [],
  allowedModels: {},
  effortPolicy: 'free',
};

interface RowState {
  draft: string;
  baseUrl: string;
  saving: boolean;
  testing: boolean;
  verdict: Verdict;
  reveal: boolean;
}

const EMPTY_ROW: RowState = { draft: '', baseUrl: '', saving: false, testing: false, verdict: null, reveal: false };

export function AdminKeysTab() {
  const [session, setSession] = useState<Session>({ loading: true, authenticated: false, user: null });
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [policyPayload, setPolicyPayload] = useState<PolicyPayload | null>(null);
  const [policyDraft, setPolicyDraft] = useState<ModelPolicy>(EMPTY_POLICY);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    fetchSession(controller.signal).then(setSession);

    return () => controller.abort();
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/providers', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (response.status === 401 || response.status === 403) {
        setError('Cette page est réservée aux administrateurs.');

        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as AdminPayload;
      setPayload(data);
      setError('');
      setRows((current) => {
        const next: Record<string, RowState> = {};

        for (const provider of data.providers) {
          next[provider.name] = { ...EMPTY_ROW, ...current[provider.name], baseUrl: provider.baseUrl };
        }

        return next;
      });
    } catch (cause) {
      setError(`Impossible de charger les clés : ${cause instanceof Error ? cause.message : 'erreur réseau'}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadPolicy = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/model-policy', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as PolicyPayload;
      setPolicyPayload(data);
      setPolicyDraft(data.policy);
      setPolicyError('');
    } catch (cause) {
      setPolicyError(
        `Impossible de charger la politique : ${cause instanceof Error ? cause.message : 'erreur réseau'}`,
      );
    }
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  const savePolicy = async (next: ModelPolicy) => {
    setPolicySaving(true);
    setPolicyError('');

    try {
      const response = await fetch('/api/admin/model-policy', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ policy: next }),
      });

      const result = (await response.json()) as { ok?: boolean; policy?: ModelPolicy; error?: string };

      if (!response.ok || !result.ok) {
        /*
         * The server refuses a policy that would leave the instance unusable (managed mode
         * with nothing allowed). Show WHY rather than a generic failure.
         */
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      setNotice('Politique enregistrée.');
      await loadPolicy();
    } catch (cause) {
      setPolicyError(cause instanceof Error ? cause.message : 'Enregistrement impossible');
      setPolicyDraft(policyPayload?.policy ?? EMPTY_POLICY);
    } finally {
      setPolicySaving(false);
    }
  };

  const toggleAllowedProvider = (name: string) => {
    const allowed = policyDraft.allowedProviders.includes(name)
      ? policyDraft.allowedProviders.filter((entry) => entry !== name)
      : [...policyDraft.allowedProviders, name];

    setPolicyDraft({ ...policyDraft, allowedProviders: allowed });
  };

  const row = (name: string): RowState => rows[name] ?? EMPTY_ROW;

  const patchRow = (name: string, patch: Partial<RowState>) =>
    setRows((current) => ({ ...current, [name]: { ...(current[name] ?? EMPTY_ROW), ...patch } }));

  const save = async (provider: AdminProvider, clear = false) => {
    patchRow(provider.name, { saving: true, verdict: null });

    try {
      const body: Record<string, unknown> = { provider: provider.name, baseUrl: row(provider.name).baseUrl };

      // A cleared key is an explicit instruction; an empty untouched field is not.
      if (clear) {
        body.apiKey = '';
      } else if (row(provider.name).draft.trim()) {
        body.apiKey = row(provider.name).draft.trim();
      }

      const response = await fetch('/api/admin/providers', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });

      const result = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      setNotice(clear ? `Clé de ${provider.label} retirée.` : `Clé de ${provider.label} enregistrée.`);
      patchRow(provider.name, { draft: '', reveal: false });
      await load();
    } catch (cause) {
      patchRow(provider.name, {
        verdict: { ok: false, detail: cause instanceof Error ? cause.message : 'Échec' },
      });
    } finally {
      patchRow(provider.name, { saving: false });
    }
  };

  const verify = async (provider: AdminProvider) => {
    patchRow(provider.name, { testing: true, verdict: null });

    try {
      const response = await fetch('/api/admin/providers/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ provider: provider.name }),
      });

      const result = (await response.json()) as { ok?: boolean; detail?: string; error?: string };

      patchRow(provider.name, {
        verdict: { ok: Boolean(result.ok), detail: result.detail || result.error || 'Réponse inattendue' },
      });
    } catch {
      patchRow(provider.name, { verdict: { ok: false, detail: 'Vérification impossible' } });
    } finally {
      patchRow(provider.name, { testing: false });
    }
  };

  const togglePersonalKeys = async (provider: AdminProvider) => {
    await fetch('/api/admin/providers', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ provider: provider.name, allowUserKeys: !provider.allowUserKeys }),
    });

    await load();
  };

  const visible = useMemo(() => {
    if (!payload) {
      return [];
    }

    const needle = filter.trim().toLowerCase();

    return needle
      ? payload.providers.filter(
          (provider) => provider.name.toLowerCase().includes(needle) || provider.label.toLowerCase().includes(needle),
        )
      : payload.providers;
  }, [payload, filter]);

  /*
   * Loading, then a hard stop for a non-admin. Waiting for the session to settle matters:
   * `isAdmin` is false while loading, and flashing "Accès refusé" at an administrator would
   * be the kind of wrong first impression the account menu already had to fix once.
   */
  if (session.loading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-sm text-bolt-elements-textSecondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Chargement…
      </div>
    );
  }

  if (!session.authenticated || !session.user?.isAdmin) {
    return (
      <div className="p-6 text-center">
        <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-bolt-elements-textTertiary" aria-hidden="true" />
        <p className="text-sm font-medium text-bolt-elements-textPrimary">Accès réservé</p>
        <p className="mt-1 text-xs text-bolt-elements-textSecondary">
          Seul un administrateur peut configurer les clés API de l'instance.
        </p>
      </div>
    );
  }

  if (error && !payload) {
    return <p className="m-4 rounded-md bg-red-500/10 p-3 text-sm text-red-500">{error}</p>;
  }

  if (!payload) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-sm text-bolt-elements-textSecondary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Chargement des fournisseurs…
      </div>
    );
  }

  const configuredCount = payload.providers.filter((provider) => provider.configured).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-bolt-elements-borderColor px-4 py-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-bolt-elements-textSecondary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Paramètres des modèles</h2>
          <span className="rounded bg-accent-500/15 px-1.5 py-0.5 text-[11px] font-medium text-bolt-elements-textPrimary">
            {configuredCount}/{payload.providers.length} clés
          </span>
        </div>
        <p className="mt-1 text-xs text-bolt-elements-textSecondary">
          Vous décidez ici <strong>ce que les autres comptes peuvent changer</strong>. Les clés, elles, servent à tous
          les comptes : elles sont chiffrées en base et ne sont jamais renvoyées au navigateur.
        </p>
      </header>

      {/* Politique : le verrou. Les clés plus bas disent qui paie. */}
      <section className="border-b border-bolt-elements-borderColor px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-bolt-elements-textSecondary" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-bolt-elements-textSecondary">
              Accès des comptes
            </h3>
          </div>
          <button
            type="button"
            onClick={() => savePolicy(policyDraft)}
            disabled={policySaving || !policyPayload}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-500/15 px-2.5 py-1.5 text-xs font-medium text-bolt-elements-textPrimary transition-colors hover:bg-accent-500/25 disabled:opacity-60"
          >
            {policySaving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            Enregistrer la politique
          </button>
        </div>

        <label className="mt-2 flex items-start gap-2 text-xs text-bolt-elements-textSecondary">
          <input
            type="checkbox"
            checked={policyDraft.managedMode}
            onChange={(event) => setPolicyDraft({ ...policyDraft, managedMode: event.target.checked })}
            className="mt-0.5"
          />
          <span>
            <strong className="text-bolt-elements-textPrimary">Mode géré</strong> : les comptes choisissent un modèle
            dans la liste autorisée et ne voient aucune clé, aucune URL, aucun réglage d'effort.
          </span>
        </label>

        <fieldset className="mt-3">
          <legend className="text-[11px] font-medium text-bolt-elements-textSecondary">
            Fournisseurs autorisés ({policyDraft.allowedProviders.length})
          </legend>
          <div className="mt-1 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {(policyPayload?.providers ?? []).map((provider) => {
              const checked = policyDraft.allowedProviders.includes(provider.name);

              return (
                <button
                  key={provider.name}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggleAllowedProvider(provider.name)}
                  className={classNames(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    checked
                      ? 'border-accent-500/40 bg-accent-500/20 text-bolt-elements-textPrimary'
                      : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                  )}
                >
                  {provider.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="policy-default-provider"
              className="text-[11px] font-medium text-bolt-elements-textSecondary"
            >
              Modèle par défaut
            </label>
            <Select
              id="policy-default-provider"
              value={policyDraft.defaultModel.provider}
              onChange={(event) =>
                setPolicyDraft({
                  ...policyDraft,
                  defaultModel: { provider: event.target.value, model: '' },
                })
              }
              className="mt-1 w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            >
              <option value="">Aucun (le compte garde son choix)</option>
              {(policyPayload?.providers ?? [])
                .filter((provider) => policyDraft.allowedProviders.includes(provider.name))
                .map((provider) => (
                  <option key={provider.name} value={provider.name}>
                    {provider.label}
                  </option>
                ))}
            </Select>
          </div>

          <div>
            <label htmlFor="policy-default-model" className="text-[11px] font-medium text-bolt-elements-textSecondary">
              Modèle
            </label>
            <input
              id="policy-default-model"
              type="text"
              value={policyDraft.defaultModel.model}
              onChange={(event) =>
                setPolicyDraft({
                  ...policyDraft,
                  defaultModel: { ...policyDraft.defaultModel, model: event.target.value },
                })
              }
              placeholder="ex. deepseek-v4.1-flash"
              className="mt-1 w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
          </div>
        </div>

        <fieldset className="mt-3">
          <legend className="text-[11px] font-medium text-bolt-elements-textSecondary">Effort de raisonnement</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-bolt-elements-textSecondary">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="policy-effort"
                checked={policyDraft.effortPolicy === 'free'}
                onChange={() => setPolicyDraft({ ...policyDraft, effortPolicy: 'free' })}
              />
              Le compte choisit
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="policy-effort"
                checked={policyDraft.effortPolicy === 'auto-only'}
                onChange={() => setPolicyDraft({ ...policyDraft, effortPolicy: 'auto-only' })}
              />
              Verrouillé sur automatique
            </label>
          </div>
        </fieldset>

        {policyError && (
          <p role="alert" className="mt-2 rounded-md bg-red-500/10 p-2 text-[11px] text-red-500">
            {policyError}
          </p>
        )}

        {policyDraft.managedMode && policyDraft.allowedProviders.length === 0 && (
          <p role="status" className="mt-2 rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-500">
            En mode géré, autorisez au moins un fournisseur : sinon aucun compte n'a de modèle utilisable et
            l'enregistrement sera refusé.
          </p>
        )}
      </section>

      {(notice || error) && (
        <p
          role="status"
          aria-live="polite"
          className={classNames(
            'mx-4 mt-3 rounded-md p-2 text-xs',
            error ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500',
          )}
        >
          {error || notice}
        </p>
      )}

      <div className="px-4 pt-3">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Rechercher un fournisseur…"
          aria-label="Rechercher un fournisseur"
          className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-1.5 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ul className="flex flex-col gap-3">
          {visible.map((provider) => {
            const state = row(provider.name);

            return (
              <li
                key={provider.name}
                data-testid={`admin-provider-${provider.name}`}
                className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-bolt-elements-textPrimary">{provider.label}</span>
                  <StatusBadge provider={provider} />
                  {provider.configured && provider.maskedKey && (
                    <code className="rounded bg-bolt-elements-background-depth-2 px-1.5 py-0.5 text-[11px] text-bolt-elements-textSecondary">
                      {provider.maskedKey}
                    </code>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="flex min-w-[220px] flex-1 items-center rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
                    <input
                      id={`admin-key-${provider.name}`}
                      type={state.reveal ? 'text' : 'password'}
                      value={state.draft}
                      onChange={(event) => patchRow(provider.name, { draft: event.target.value })}
                      placeholder={provider.needsKey ? 'Saisir la clé API' : "Saisir l'URL du service"}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`Nouvelle clé pour ${provider.label}`}
                      className="w-full bg-transparent px-2 py-1.5 text-sm text-bolt-elements-textPrimary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => patchRow(provider.name, { reveal: !state.reveal })}
                      aria-pressed={state.reveal}
                      aria-controls={`admin-key-${provider.name}`}
                      aria-label={state.reveal ? 'Masquer la clé saisie' : 'Afficher la clé saisie'}
                      title={state.reveal ? 'Masquer la clé saisie' : 'Afficher la clé saisie'}
                      className="bg-transparent px-2 py-1.5 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
                    >
                      {state.reveal ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => save(provider)}
                    disabled={state.saving}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent-500/15 px-2.5 py-1.5 text-xs font-medium text-bolt-elements-textPrimary transition-colors hover:bg-accent-500/25 disabled:opacity-60"
                  >
                    {state.saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                    Enregistrer
                  </button>

                  <button
                    type="button"
                    onClick={() => verify(provider)}
                    disabled={state.testing}
                    className="inline-flex items-center gap-1.5 rounded-md bg-bolt-elements-background-depth-2 px-2.5 py-1.5 text-xs font-medium text-bolt-elements-textSecondary transition-colors hover:text-bolt-elements-textPrimary disabled:opacity-60"
                  >
                    {state.testing && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                    Vérifier
                  </button>

                  {provider.configured && provider.source === 'instance' && (
                    <button
                      type="button"
                      onClick={() => save(provider, true)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      Retirer
                    </button>
                  )}
                </div>

                <label className="mt-2 flex items-start gap-2 text-[11px] text-bolt-elements-textSecondary">
                  <input
                    type="checkbox"
                    checked={provider.allowUserKeys}
                    onChange={() => togglePersonalKeys(provider)}
                    className="mt-0.5"
                  />
                  <span>Autoriser chaque utilisateur à saisir sa propre clé pour ce fournisseur</span>
                </label>

                {state.verdict && (
                  <p
                    role="status"
                    aria-live="polite"
                    className={classNames(
                      'mt-1.5 flex items-center gap-1 text-[11px]',
                      state.verdict.ok ? 'text-green-500' : 'text-red-500',
                    )}
                  >
                    {state.verdict.ok ? (
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    )}
                    {state.verdict.detail}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StatusBadge({ provider }: { provider: AdminProvider }) {
  if (provider.source === 'environment') {
    return (
      <span className="rounded bg-bolt-elements-background-depth-2 px-1.5 py-0.5 text-[11px] text-bolt-elements-textSecondary">
        fournie par le serveur
      </span>
    );
  }

  if (provider.configured) {
    return (
      <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[11px] font-medium text-green-500">configurée</span>
    );
  }

  return (
    <span className="rounded bg-bolt-elements-background-depth-2 px-1.5 py-0.5 text-[11px] text-bolt-elements-textTertiary">
      {provider.needsKey ? 'absente' : 'non configurée'}
    </span>
  );
}

export default AdminKeysTab;
