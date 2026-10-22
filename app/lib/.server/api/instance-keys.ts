/**
 * Provider keys resolved by the server, from the instance's administrator.
 *
 * Until now a key could only come from two places: the user's `apiKeys` cookie, or a
 * environment variable baked into the container. Neither is "the administrator configures the
 * providers for everybody": the first asks every colleague for their own key, the second
 * needs a redeploy to change. This module adds the third source, and puts it in the order the
 * operator expects:
 *
 *   1. an INSTANCE key set by an admin (accounts service, encrypted in Postgres);
 *   2. the user's own key, only for a provider the admin opened to users;
 *   3. the deployment's environment variable (OpenCode Go today).
 *
 * Why it talks to the accounts service instead of reading Postgres: this code runs inside a
 * Cloudflare Worker, which has NO filesystem and no database driver. An HTTP call to the host
 * service is the only wiring that works, and it keeps the decryption key inside the one process
 * that owns it. The route is loopback-only and nginx never proxies `/internal/`, so a browser
 * cannot reach it.
 *
 * Nothing here is ever returned to a client: the functions are called from loaders/actions that
 * spend the key on an outbound request.
 */

import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('instanceKeys');

/** Where the accounts service answers, as seen from inside the container. */
const DEFAULT_ACCOUNTS_URL = 'http://host.docker.internal:8210';

/**
 * One short cache. A page load can fire several model/chat requests in a burst, and each one
 * otherwise costs a loopback round trip plus two AES decryptions. Short enough that saving a
 * key in the admin page is visible on the next message, long enough to absorb a burst.
 */
const CACHE_TTL_MS = 5_000;

interface ResolvedKeys {
  apiKeys: Record<string, string>;
  baseUrls: Record<string, string>;
  allowUserKeys: string[];
  source: Record<string, 'instance' | 'user'>;

  /**
   * What the administrator allows, as opposed to what happens to work. The chat routes read
   * this to refuse a provider/model pair, and the composer reads it to list only what is
   * permitted. Absent (older accounts service) means "no policy": see NO_POLICY.
   */
  policy: ModelPolicy;
}

export interface ModelPolicy {
  defaultModel: { provider: string; model: string };
  allowedProviders: string[];
  allowedModels: Record<string, string[]>;
  effortPolicy: 'free' | 'auto-only';
}

/**
 * The policy when the service does not send one. It keeps the behaviour that predates the
 * policy (every provider served, effort free, personal keys closed), because silently
 * narrowing an existing deployment would lock accounts out of working models.
 */
export const NO_POLICY: ModelPolicy = {
  defaultModel: { provider: '', model: '' },
  allowedProviders: [],
  allowedModels: {},
  effortPolicy: 'free',
};

const EMPTY: ResolvedKeys = { apiKeys: {}, baseUrls: {}, allowUserKeys: [], source: {}, policy: NO_POLICY };

const cache = new Map<string, { at: number; value: ResolvedKeys }>();

/**
 * Clear the short cache. Exists for tests: a module-level cache survives between cases, so a
 * second case would read the first one's answer instead of the service it just stubbed.
 */
export function __resetKeyCacheForTests(): void {
  cache.clear();
}

function accountsUrl(env: Record<string, unknown> | undefined): string {
  const configured = (env?.ACCOUNTS_INTERNAL_URL || env?.DESIGN_ACCOUNTS_URL || process.env.ACCOUNTS_INTERNAL_URL) as
    string | undefined;

  return (configured || DEFAULT_ACCOUNTS_URL).replace(/\/$/, '');
}

/**
 * The keys this request may use, already merged and ordered.
 *
 * A failure is NOT an empty answer: an unreachable accounts service falls back to the cookie
 * and the environment (which still work), and says so in the log. Treating it as "no keys"
 * would be indistinguishable from "the admin configured nothing".
 */
export async function resolveProviderKeys(args: {
  env?: Record<string, unknown>;
  userId?: string | null;
  cookieKeys?: Record<string, string>;
}): Promise<ResolvedKeys> {
  const { env, userId, cookieKeys } = args;
  const cacheKey = userId || '__anonymous__';
  const hit = cache.get(cacheKey);

  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return mergeLocalKeys(hit.value, cookieKeys);
  }

  let remote = EMPTY;

  try {
    const url = new URL(`${accountsUrl(env)}/internal/effective-keys`);

    if (userId) {
      url.searchParams.set('user_id', userId);
    }

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(3000) });

    if (response.ok) {
      const body = (await response.json()) as Partial<ResolvedKeys>;
      remote = {
        apiKeys: isStringMap(body.apiKeys) ? body.apiKeys : {},
        baseUrls: isStringMap(body.baseUrls) ? body.baseUrls : {},
        allowUserKeys: Array.isArray(body.allowUserKeys) ? body.allowUserKeys.filter(isString) : [],
        source: (body.source && typeof body.source === 'object' ? body.source : {}) as ResolvedKeys['source'],
        policy: normalisePolicy(body.policy),
      };
    } else {
      logger.warn(`accounts service answered ${response.status}; using cookie and environment keys`);
    }
  } catch {
    /* No log line with any value: only the fact that the lookup failed. */
    logger.warn('accounts service unreachable; using cookie and environment keys');
  }

  cache.set(cacheKey, { at: Date.now(), value: remote });

  return mergeLocalKeys(remote, cookieKeys);
}

/**
 * Lay the request's own cookie keys underneath the resolved ones.
 *
 * The cookie is the freshest intent typed on this device, BUT only for a provider the admin
 * left open. For a managed provider the instance key wins: a stale personal key must not
 * override the key the operator rotated, nor quietly bill the wrong account.
 */
function mergeLocalKeys(remote: ResolvedKeys, cookieKeys?: Record<string, string>): ResolvedKeys {
  const apiKeys: Record<string, string> = {};

  for (const [provider, value] of Object.entries(cookieKeys || {})) {
    if (typeof value === 'string' && value && remote.allowUserKeys.includes(provider)) {
      apiKeys[provider] = value;
    }
  }

  const source: ResolvedKeys['source'] = {};

  for (const provider of Object.keys(apiKeys)) {
    source[provider] = 'user';
  }

  /* Instance keys are laid ON TOP: the operator's policy outranks a local paste. */
  for (const [provider, value] of Object.entries(remote.apiKeys)) {
    apiKeys[provider] = value;
    source[provider] = 'instance';
  }

  return { apiKeys, baseUrls: remote.baseUrls, allowUserKeys: remote.allowUserKeys, source, policy: remote.policy };
}

/** Which providers a user may key themselves. Empty means "the admin decides for everyone". */
export async function allowedUserKeyProviders(env?: Record<string, unknown>): Promise<string[]> {
  const resolved = await resolveProviderKeys({ env });

  return resolved.allowUserKeys;
}

/**
 * Clamp the policy a service sends into the documented shape.
 *
 * The service validates on write, but this value decides whether a chat is refused, so a
 * malformed or truncated body must resolve to the permissive default rather than to an
 * empty list that would deny every model to everybody.
 */
function normalisePolicy(raw: unknown): ModelPolicy {
  if (!raw || typeof raw !== 'object') {
    return NO_POLICY;
  }

  const value = raw as Partial<ModelPolicy> & { defaultModel?: unknown };
  const allowedModels: Record<string, string[]> = {};

  if (value.allowedModels && typeof value.allowedModels === 'object') {
    for (const [provider, models] of Object.entries(value.allowedModels)) {
      if (Array.isArray(models)) {
        allowedModels[provider] = models.filter(isString);
      }
    }
  }

  const defaultModel =
    value.defaultModel && typeof value.defaultModel === 'object'
      ? {
          provider: isString((value.defaultModel as { provider?: unknown }).provider)
            ? String((value.defaultModel as { provider?: string }).provider)
            : '',
          model: isString((value.defaultModel as { model?: unknown }).model)
            ? String((value.defaultModel as { model?: string }).model)
            : '',
        }
      : { provider: '', model: '' };

  return {
    defaultModel,
    allowedProviders: Array.isArray(value.allowedProviders) ? value.allowedProviders.filter(isString) : [],
    allowedModels,
    effortPolicy: value.effortPolicy === 'auto-only' ? 'auto-only' : 'free',
  };
}

/**
 * Is this provider served by the instance at all?
 *
 * `allowedProviders` is the ONE rule (the admin switchboard). An empty list means no policy was
 * ever written, and then everything the deployment ships is served: that is the behaviour that
 * predates the switchboard, and writing an empty default would otherwise turn a working
 * instance into one that answers nothing.
 */
export function isProviderEnabled(policy: ModelPolicy, provider: string): boolean {
  if (policy.allowedProviders.length === 0) {
    return true;
  }

  return policy.allowedProviders.includes(provider);
}

/**
 * The provider every account starts on when it has no saved choice of its own.
 *
 * The policy is the source; an EMPTY provider in the policy means "no preference", so the
 * deployment's build-time default applies, unless the admin disabled it, in which case the
 * first provider they did enable is used: a composer that opens on a provider the server
 * refuses is worse than one that opens on an allowed one the user did not pick.
 */
export function resolveDefaultProvider(policy: ModelPolicy, fallback: string): string {
  const chosen = policy.defaultModel.provider;

  if (chosen && isProviderEnabled(policy, chosen)) {
    return chosen;
  }

  if (policy.allowedProviders.length > 0) {
    return isProviderEnabled(policy, fallback) ? fallback : policy.allowedProviders[0];
  }

  return fallback;
}

/**
 * Why this provider/model pair must be refused, or an empty string when it is allowed.
 *
 * This is the server-side guard. Hiding a provider in the composer is convenience; a request
 * posted straight to `/api/chat` must meet the same rule, or the policy is decoration.
 * A permissive policy (nothing configured) allows everything, which keeps a deployment that
 * never set one working exactly as before.
 */
export function modelPolicyViolation(policy: ModelPolicy, provider: string, model?: string): string {
  if (!isProviderEnabled(policy, provider)) {
    return `Le fournisseur ${provider} n'est pas autorisé sur cette instance.`;
  }

  const allowed = policy.allowedModels[provider];

  if (allowed && allowed.length > 0 && model && !allowed.includes(model)) {
    return `Le modèle ${model} n'est pas autorisé pour ${provider}.`;
  }

  return '';
}

/** The single model policy, for the composer and for tests. */
export async function modelPolicy(env?: Record<string, unknown>): Promise<ModelPolicy> {
  const resolved = await resolveProviderKeys({ env });

  return resolved.policy;
}

/** Base URLs an admin set for a provider (self-hosted gateways); never sent to a browser. */
export async function instanceBaseUrls(env?: Record<string, unknown>): Promise<Record<string, string>> {
  const resolved = await resolveProviderKeys({ env });

  return resolved.baseUrls;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringMap(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && Object.values(value as object).every(isString);
}
