import Cookies from 'js-cookie';
import { API_KEYS_UPDATED_EVENT, type ApiKeysUpdatedDetail } from '~/lib/api/apiKeys';
import { createScopedLogger } from '~/utils/logger';

/*
 * Account-scoped settings, stored in PostgreSQL so they follow the user between devices.
 *
 * Everything the onboarding wizard collects used to live in localStorage or a cookie: the
 * profile name and avatar, the appearance choices, and the API keys. localStorage is
 * per-browser, so signing in on a phone asked for all of it again, and clearing site data
 * lost the keys for good. These functions move that state onto the account.
 *
 * API keys are the sensitive part: they are sent to `/api/auth/secrets` where the server
 * encrypts them (AES-256-GCM) before writing. The listing returns only the NAMES that exist.
 * Exactly one value can be read back, the model providers' keys (`provider_settings`), and only
 * by the signed-in account that stored them: a second device needs them or it is told a key
 * exists and can never use it. Every connection token (GitHub, GitLab, Netlify, Vercel, Supabase,
 * MCP) stays write-only. The browser keeps its local copy so an offline start still
 * works, but the account is what makes a second device stop asking.
 *
 * Every call fails soft. An unreachable server must not block the UI, which keeps working
 * from what the browser already holds.
 */
const logger = createScopedLogger('AccountSettings');

const PREFERENCES_ENDPOINT = '/api/auth/preferences';
const SECRETS_ENDPOINT = '/api/auth/secrets';

export const PROFILE_STORAGE_KEY = 'bolt_profile';
export const INTERFACE_OPTIONS_STORAGE_KEY = 'bolt_interface_options';
export const ONBOARDING_COMPLETED_KEY = 'bolt_onboarding_completed';

/*
 * Secret names the server accepts. A name outside this list is dropped there, so sending one
 * would silently do nothing — keep the two lists in step.
 */
export const SECRET_NAMES = [
  'provider_settings',
  'github_connection',
  'gitlab_connection',
  'netlify_connection',
  'vercel_connection',
  'supabaseCredentials',
  'supabase_connection',
  'mcp_settings',
  'auto_enabled_providers',
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

/*
 * Preference keys this module owns. `theme`, `language` and `toolAccessMode` are handled by
 * ~/lib/preferences, which runs earlier in the boot; overlapping here would let two writers
 * race for the same key.
 */
export const ACCOUNT_PREFERENCE_KEYS = [
  'profileName',
  'profileAvatar',
  'onboardingCompleted',
  'interfaceOptions',
  'sidebarOpen',
  'tabConfiguration',
  'zipAutorun',
  'defaultProjectType',
  'defaultProjectName',
] as const;

export type AccountPreferenceKey = (typeof ACCOUNT_PREFERENCE_KEYS)[number];

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/**
 * The settings worth syncing, read straight from this browser.
 *
 * Unreadable JSON is skipped rather than thrown: a corrupt localStorage entry must not stop
 * the rest of the account's settings from being uploaded.
 */
export function readAccountPreferences(): Record<string, unknown> {
  if (!isBrowser()) {
    return {};
  }

  const values: Record<string, unknown> = {};

  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}') as {
      username?: unknown;
      avatar?: unknown;
    };

    if (typeof profile.username === 'string' && profile.username.trim()) {
      values.profileName = profile.username.trim();
    }

    if (typeof profile.avatar === 'string' && profile.avatar) {
      values.profileAvatar = profile.avatar;
    }
  } catch (error) {
    logger.debug('profile entry is not readable, skipping it', error);
  }

  /*
   * The completion flag travels only when the browser also holds something a user actually
   * configured. On its own it is not evidence: the app writes it during a normal run, and
   * uploading a bare `true` to an untouched account would tell every other device the setup is
   * done — making the wizard unreachable for good, on every device.
   */
  const completed = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
  const hasRealSetup = Boolean(values.profileName || values.profileAvatar);

  if (completed === 'true' && hasRealSetup) {
    values.onboardingCompleted = true;
  }

  const rawOptions = localStorage.getItem(INTERFACE_OPTIONS_STORAGE_KEY);

  if (rawOptions) {
    try {
      /*
       * Stored as a JSON string by the onboarding wizard; the server column is text, so the
       * encoding has to survive the trip unchanged.
       */
      JSON.parse(rawOptions);
      values.interfaceOptions = rawOptions;
    } catch (error) {
      logger.debug('interface options are not valid JSON, skipping them', error);
    }
  }

  return values;
}

async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      ...init,
    });

    let data: Record<string, unknown> | null = null;

    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = null;
    }

    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    logger.debug('account settings request failed', url, error);

    return { ok: false, status: 0, data: null };
  }
}

/** Read the account's preferences. A 401 means signed out, which is not an error. */
export async function fetchAccountPreferences(): Promise<Record<string, unknown> | null> {
  const result = await requestJson(PREFERENCES_ENDPOINT);

  if (!result.ok || !result.data) {
    return null;
  }

  const preferences = result.data.preferences;

  return preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>) : {};
}

/** Push only the keys this module owns; the server ignores anything else. */
export async function pushAccountPreferences(values: Record<string, unknown>): Promise<boolean> {
  const body: Record<string, unknown> = {};

  for (const key of ACCOUNT_PREFERENCE_KEYS) {
    if (values[key] !== undefined) {
      body[key] = values[key];
    }
  }

  if (!Object.keys(body).length) {
    return true;
  }

  const result = await requestJson(PREFERENCES_ENDPOINT, { method: 'PUT', body: JSON.stringify(body) });

  if (!result.ok) {
    logger.debug('could not save account preferences', result.status);
  }

  return result.ok;
}

/**
 * Write the account's values into this browser.
 *
 * Returns true when something changed so the caller can re-render. The onboarding flag is
 * the important one: a fresh device learns here that the wizard is already done, which is
 * what stops it from asking again.
 */
export function applyAccountPreferences(preferences: Record<string, unknown>): boolean {
  if (!isBrowser()) {
    return false;
  }

  let changed = false;

  const name = preferences.profileName;
  const avatar = preferences.profileAvatar;

  if ((typeof name === 'string' && name) || (typeof avatar === 'string' && avatar)) {
    try {
      const current = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}') as Record<string, unknown>;
      const next = { ...current };

      if (typeof name === 'string' && name && current.username !== name) {
        next.username = name;
      }

      if (typeof avatar === 'string' && avatar && current.avatar !== avatar) {
        next.avatar = avatar;
      }

      if (JSON.stringify(next) !== JSON.stringify(current)) {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
        changed = true;
      }
    } catch (error) {
      logger.debug('could not merge the account profile locally', error);
    }
  }

  if (preferences.onboardingCompleted === true && localStorage.getItem(ONBOARDING_COMPLETED_KEY) !== 'true') {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    changed = true;
  }

  const options = preferences.interfaceOptions;

  if (typeof options === 'string' && options) {
    try {
      JSON.parse(options);

      if (localStorage.getItem(INTERFACE_OPTIONS_STORAGE_KEY) !== options) {
        localStorage.setItem(INTERFACE_OPTIONS_STORAGE_KEY, options);
        changed = true;
      }
    } catch (error) {
      logger.debug('server interface options are not valid JSON, ignoring them', error);
    }
  }

  return changed;
}

/**
 * One round trip on load: take what the account has, upload what it is missing.
 *
 * The upload matters for the first device: it is what seeds the account, so the second
 * device has something to inherit instead of re-asking.
 */
export async function syncAccountSettings(): Promise<'synced' | 'seeded' | 'offline' | 'nothing'> {
  const local = readAccountPreferences();
  const remote = await fetchAccountPreferences();

  if (remote === null) {
    return 'offline';
  }

  const missing: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(local)) {
    if (remote[key] === undefined) {
      missing[key] = value;
    }
  }

  const seeded = Object.keys(missing).length > 0;

  if (seeded) {
    await pushAccountPreferences(missing);
  }

  const changed = applyAccountPreferences(remote);

  if (seeded) {
    return 'seeded';
  }

  return changed ? 'synced' : 'nothing';
}

/**
 * Push this browser's settings to the account. Called when the wizard finishes, so the
 * choices are on the account before a second device ever asks.
 *
 * `onboardingCompleted` is only sent when the browser actually holds a profile. Without that
 * guard the helper could mark an untouched account as configured — and since the flag is what
 * suppresses the wizard everywhere, that would make the setup unreachable on every device,
 * including this one, with no way back from the UI.
 */
export async function saveOnboardingToAccount(extra: Record<string, unknown> = {}): Promise<boolean> {
  const values = readAccountPreferences();
  const body = { ...values, ...extra };
  const configured = Boolean(body.profileName || body.profileAvatar);

  if (!configured) {
    // Nothing was really configured, so do not claim otherwise on the account.
    delete body.onboardingCompleted;
  } else {
    body.onboardingCompleted = true;
  }

  if (!Object.keys(body).length) {
    return true;
  }

  return pushAccountPreferences(body);
}

/** Names of the secrets the account holds. Never the values. */
export async function fetchSecretNames(): Promise<string[] | null> {
  const result = await requestJson(SECRETS_ENDPOINT);

  if (!result.ok || !result.data) {
    return null;
  }

  const names = result.data.names;

  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
}

/** What the browser has in the `apiKeys` cookie, minus the empty placeholders. */
function readLocalApiKeys(): Record<string, string> {
  const raw = Cookies.get('apiKeys');

  if (!raw) {
    return {};
  }

  try {
    return keepNonEmptyStrings(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Only string values that hold something. The chat writes `{"<provider>":""}` on mount even
 * when no key was ever entered, so an empty string means "nothing here", not "a key".
 */
function keepNonEmptyStrings(value: unknown): Record<string, string> {
  const kept: Record<string, string> = {};

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return kept;
  }

  for (const [provider, key] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim()) {
      kept[provider] = key.trim();
    }
  }

  return kept;
}

/**
 * Bring the account's provider keys to this device.
 *
 * The first device stores its key on the account, encrypted. Without this the second device
 * learned that a key existed (the wizard even tells the user "they will be used automatically")
 * yet had no way to obtain it, so the wizard stayed closed while every model request failed for
 * want of a key.
 *
 * The rules are about not doing harm:
 *   - a key already present on this device always wins; the account only fills the gaps, because
 *     what was just typed here is the freshest intent;
 *   - empty or malformed values from the account are ignored, never written;
 *   - an unreachable or refusing server changes nothing (the app keeps working from this device);
 *   - nothing is logged that could contain a key.
 */
export async function restoreApiKeysFromAccount(): Promise<'restored' | 'nothing' | 'offline'> {
  const result = await requestJson(`${SECRETS_ENDPOINT}?name=provider_settings`);

  if (!result.ok || !result.data) {
    return 'offline';
  }

  const stored = result.data.value;

  if (typeof stored !== 'string' || !stored) {
    return 'nothing';
  }

  let fromAccount: Record<string, string>;

  try {
    fromAccount = keepNonEmptyStrings(JSON.parse(stored));
  } catch {
    // Not the JSON this module wrote. Leave the cookie alone and say nothing about the content.
    logger.warn('the account holds a provider key in an unexpected format; ignored');

    return 'nothing';
  }

  const local = readLocalApiKeys();
  const merged = { ...fromAccount, ...local };
  const added = Object.keys(merged).filter((provider) => local[provider] === undefined);

  if (!added.length) {
    return 'nothing';
  }

  Cookies.set('apiKeys', JSON.stringify(merged), { expires: 365 });
  window.dispatchEvent(
    new CustomEvent<ApiKeysUpdatedDetail>(API_KEYS_UPDATED_EVENT, {
      detail: { apiKeys: merged, providerName: added[0] },
    }),
  );

  return 'restored';
}

/**
 * Store the keys typed on this device on the account, WITHOUT erasing what other devices put
 * there.
 *
 * `provider_settings` is one value holding every provider's key, and the server replaces it as a
 * whole. Sending only this device's cookie would therefore delete the keys a second device had
 * stored, the moment the first one saved. So the account's current keys are read first and the
 * ones typed here are laid over them (same provider: this device wins, it is the freshest).
 *
 * If the account cannot be read, nothing is written. An unreachable account is not an empty one,
 * and treating it as empty is exactly how every other device's keys would be lost.
 */
export async function storeApiKeysOnAccount(typedHere: Record<string, string>): Promise<boolean> {
  const mine = keepNonEmptyStrings(typedHere);

  if (!Object.keys(mine).length) {
    return true;
  }

  const current = await requestJson(`${SECRETS_ENDPOINT}?name=provider_settings`);

  if (!current.ok || !current.data) {
    logger.warn('could not read the account keys before saving; not writing over them');

    return false;
  }

  let onAccount: Record<string, string> = {};

  if (typeof current.data.value === 'string' && current.data.value) {
    try {
      onAccount = keepNonEmptyStrings(JSON.parse(current.data.value));
    } catch {
      onAccount = {};
    }
  }

  return pushSecrets({ provider_settings: JSON.stringify({ ...onAccount, ...mine }) });
}

/**
 * Send secrets for the account to encrypt and store.
 *
 * Empty values are dropped here: the caller frequently has "this connection is not
 * configured" as an empty string, and sending it would store an encrypted blank instead of
 * leaving the account's real value alone.
 */
export async function pushSecrets(secrets: Record<string, unknown>): Promise<boolean> {
  const body: Record<string, string> = {};

  for (const name of SECRET_NAMES) {
    const value = secrets[name];

    if (typeof value === 'string' && value) {
      body[name] = value;
    }
  }

  if (!Object.keys(body).length) {
    return true;
  }

  const result = await requestJson(SECRETS_ENDPOINT, { method: 'PUT', body: JSON.stringify(body) });

  if (!result.ok) {
    /*
     * 503 means the server has no encryption key configured. Surface it: silently keeping the
     * secret only in the browser is the exact behaviour this module exists to remove.
     */
    logger.warn('could not store secrets on the account', result.status);
  }

  return result.ok;
}

/** Forget the named secrets on the account. */
export async function deleteSecrets(names: string[]): Promise<boolean> {
  const wanted = names.filter((name): name is SecretName => (SECRET_NAMES as readonly string[]).includes(name));

  if (!wanted.length) {
    return true;
  }

  const result = await requestJson(SECRETS_ENDPOINT, { method: 'DELETE', body: JSON.stringify({ names: wanted }) });

  return result.ok;
}
