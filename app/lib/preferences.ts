import { createScopedLogger } from '~/utils/logger';

/*
 * Account preferences, stored in PostgreSQL so they follow the user between devices.
 *
 * Theme, interface options and the tool-access mode used to live only in localStorage, which is
 * per-browser: choosing a dark theme on the desktop left the phone on light. These functions
 * push the local choice to the account and pull it back on the next device.
 *
 * Everything here fails soft. An unreachable server must never stop the UI from applying the
 * settings the browser already holds — the local value stays authoritative until a sync lands.
 */
const logger = createScopedLogger('PreferencesSync');

const ENDPOINT = '/api/auth/preferences';

/** Keys the server will store. Anything else is rejected there, so do not send it. */
export const SYNCED_KEYS = [
  'theme',
  'language',
  'autoSelectTemplate',
  'latestBranch',
  'toolAccessMode',
  'defaultModel',
  'defaultProvider',
] as const;

export type SyncedKey = (typeof SYNCED_KEYS)[number];

/** localStorage key -> preference key. */
const LOCAL_BINDINGS: Array<{ storage: string; key: SyncedKey; parse: (raw: string) => unknown }> = [
  { storage: 'bolt_theme', key: 'theme', parse: (raw) => raw },
  { storage: 'tool_access_mode', key: 'toolAccessMode', parse: (raw) => raw },
  {
    storage: 'bolt_interface_options',
    key: 'language',
    parse: (raw) => {
      try {
        const parsed = JSON.parse(raw) as { language?: unknown };

        return typeof parsed?.language === 'string' ? parsed.language : undefined;
      } catch {
        return undefined;
      }
    },
  },
];

export interface Preferences {
  [key: string]: unknown;
}

/** Read the current preferences from this browser. */
export function readLocalPreferences(): Preferences {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  const values: Preferences = {};

  for (const binding of LOCAL_BINDINGS) {
    const raw = localStorage.getItem(binding.storage);

    if (raw === null) {
      continue;
    }

    const value = binding.parse(raw);

    if (value !== undefined && value !== null) {
      values[binding.key] = value;
    }
  }

  return values;
}

export async function fetchPreferences(): Promise<{ ok: boolean; preferences?: Preferences }> {
  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });

    if (!response.ok) {
      return { ok: false };
    }

    const payload = (await response.json()) as { ok?: boolean; preferences?: Preferences };

    return { ok: true, preferences: payload.preferences ?? {} };
  } catch (error) {
    logger.debug('could not read account preferences', error);

    return { ok: false };
  }
}

export async function pushPreferences(preferences: Preferences): Promise<boolean> {
  const body: Preferences = {};

  for (const key of SYNCED_KEYS) {
    if (key in preferences) {
      body[key] = preferences[key];
    }
  }

  if (!Object.keys(body).length) {
    return true;
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return response.ok;
  } catch (error) {
    logger.debug('could not save account preferences', error);

    return false;
  }
}

/**
 * Apply server preferences to this browser.
 *
 * Returns true when something changed, so the caller can re-render. Local values that are
 * absent on the server are pushed up instead, which is how the first device seeds the account.
 */
export function applyPreferences(preferences: Preferences): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }

  let changed = false;

  for (const binding of LOCAL_BINDINGS) {
    const incoming = preferences[binding.key];

    if (incoming === undefined || incoming === null) {
      continue;
    }

    const next = String(incoming);
    const current = localStorage.getItem(binding.storage);

    if (binding.storage === 'bolt_interface_options') {
      try {
        const parsed = JSON.parse(current || '{}');
        parsed.language = next;

        const encoded = JSON.stringify(parsed);

        if (encoded !== current) {
          localStorage.setItem(binding.storage, encoded);
          changed = true;
        }
      } catch {
        localStorage.setItem(binding.storage, JSON.stringify({ language: next }));
        changed = true;
      }

      continue;
    }

    if (current !== next) {
      localStorage.setItem(binding.storage, next);
      changed = true;
    }
  }

  return changed;
}

/**
 * One round trip on load: take what the account has, and upload anything it is missing.
 * Called once when the app starts, so a fresh browser inherits the account's settings.
 */
export async function syncPreferences(): Promise<'synced' | 'seeded' | 'offline' | 'nothing'> {
  const local = readLocalPreferences();
  const remote = await fetchPreferences();

  if (!remote.ok) {
    return 'offline';
  }

  const remoteValues = remote.preferences ?? {};
  const missingOnServer: Preferences = {};

  for (const [key, value] of Object.entries(local)) {
    if (remoteValues[key] === undefined) {
      missingOnServer[key] = value;
    }
  }

  const seeded = Object.keys(missingOnServer).length > 0;

  if (seeded) {
    // First run on this account: the browser's choices become the account's choices.
    await pushPreferences(missingOnServer);
  }

  const changed = applyPreferences(remoteValues);

  /*
   * Report what actually happened, seeding included. Returning 'nothing' after successfully
   * uploading the account's first preferences hid the one case the caller most wants to know
   * about; a later push that changes values still reports 'synced'.
   */
  if (seeded) {
    return 'seeded';
  }

  return changed ? 'synced' : 'nothing';
}
