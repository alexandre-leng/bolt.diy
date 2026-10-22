import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('instanceKeys');

/** Where the accounts service answers, as seen from inside the container. */
const DEFAULT_ACCOUNTS_URL = 'http://host.docker.internal:8210';

/** One brief cache reduces loopback round trips during a burst of model requests. */
const CACHE_TTL_MS = 5_000;

interface ResolvedKeys {
  apiKeys: Record<string, string>;
  baseUrls: Record<string, string>;
  allowUserKeys: string[];
  source: Record<string, 'instance' | 'user'>;
  policy: ModelPolicy;
  policyUnavailable: boolean;
}

export interface ModelPolicy {
  managedMode: boolean;
  defaultModel: { provider: string; model: string };
  allowedProviders: string[];
  allowedModels: Record<string, string[]>;
  effortPolicy: 'free' | 'auto-only';
}

/** Policy used only when the accounts service explicitly provides no policy. */
export const NO_POLICY: ModelPolicy = {
  managedMode: false,
  defaultModel: { provider: '', model: '' },
  allowedProviders: [],
  allowedModels: {},
  effortPolicy: 'free',
};

const EMPTY: ResolvedKeys = {
  apiKeys: {},
  baseUrls: {},
  allowUserKeys: [],
  source: {},
  policy: NO_POLICY,
  policyUnavailable: true,
};

const cache = new Map<string, { at: number; value: ResolvedKeys }>();

export function __resetKeyCacheForTests(): void {
  cache.clear();
}

function accountsUrl(env: Record<string, unknown> | undefined): string {
  const configured = (env?.ACCOUNTS_INTERNAL_URL || env?.DESIGN_ACCOUNTS_URL || process.env.ACCOUNTS_INTERNAL_URL) as
    string | undefined;

  return (configured || DEFAULT_ACCOUNTS_URL).replace(/\/$/, '');
}

/** Resolve keys and policy, retaining last-known-good state if the service is temporarily down. */
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

  let remote: ResolvedKeys | undefined;

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
        policyUnavailable: false,
      };
      cache.set(cacheKey, { at: Date.now(), value: remote });
    } else {
      logger.warn(`accounts service answered ${response.status}; preserving last known policy`);
    }
  } catch {
    logger.warn('accounts service unreachable; preserving last known policy');
  }

  if (!remote) {
    remote = hit?.value ?? EMPTY;

    if (!hit) {
      return { ...EMPTY, policyUnavailable: true };
    }
  }

  return mergeLocalKeys(remote, cookieKeys);
}

/** Keep personal keys only for providers the last valid policy explicitly opens. */
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

  for (const [provider, value] of Object.entries(remote.apiKeys)) {
    apiKeys[provider] = value;
    source[provider] = 'instance';
  }

  return {
    apiKeys,
    baseUrls: remote.baseUrls,
    allowUserKeys: remote.allowUserKeys,
    source,
    policy: remote.policy,
    policyUnavailable: remote.policyUnavailable,
  };
}

export async function allowedUserKeyProviders(env?: Record<string, unknown>): Promise<string[]> {
  const resolved = await resolveProviderKeys({ env });

  return resolved.allowUserKeys;
}

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
    managedMode: Boolean(value.managedMode),
    defaultModel,
    allowedProviders: Array.isArray(value.allowedProviders) ? value.allowedProviders.filter(isString) : [],
    allowedModels,
    effortPolicy: value.effortPolicy === 'auto-only' ? 'auto-only' : 'free',
  };
}

export function policyUnavailableResponse(resolved: Pick<ResolvedKeys, 'policyUnavailable'>): Response | undefined {
  return resolved.policyUnavailable
    ? Response.json({ error: 'Politique de modèles temporairement indisponible' }, { status: 503 })
    : undefined;
}

export function modelPolicyViolation(policy: ModelPolicy, provider: string, model?: string): string {
  if (!policy.managedMode) {
    return '';
  }

  if (!policy.allowedProviders.includes(provider)) {
    return `Le fournisseur ${provider} n'est pas autorisé sur cette instance.`;
  }

  const allowed = policy.allowedModels[provider];

  if (allowed && allowed.length > 0 && model && !allowed.includes(model)) {
    return `Le modèle ${model} n'est pas autorisé pour ${provider}.`;
  }

  return '';
}

export async function modelPolicy(env?: Record<string, unknown>): Promise<ModelPolicy> {
  const resolved = await resolveProviderKeys({ env });

  return resolved.policy;
}

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
