/**
 * Tests for the account-scoped settings sync.
 *
 * The behaviour that matters here is what a *second* device sees. These cover the three
 * ways it could still be asked to redo the onboarding:
 *   - the account holds the profile but the browser never applies it
 *   - the account holds `onboardingCompleted` but the flag is not written locally
 *   - the first device never uploads, so the account stays empty and every device re-asks
 *
 * They also pin the rule that secrets are sent for encryption, that only the provider key can be
 * read back (and merged, never overwritten), and that connection tokens stay write-only.
 */
import Cookies from 'js-cookie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_PREFERENCE_KEYS,
  applyAccountPreferences,
  deleteSecrets,
  fetchSecretNames,
  INTERFACE_OPTIONS_STORAGE_KEY,
  ONBOARDING_COMPLETED_KEY,
  PROFILE_STORAGE_KEY,
  pushSecrets,
  readAccountPreferences,
  restoreApiKeysFromAccount,
  saveOnboardingToAccount,
  storeApiKeysOnAccount,
  syncAccountSettings,
} from './accountSettings';
import { API_KEYS_UPDATED_EVENT } from '~/lib/api/apiKeys';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('accountSettings', () => {
  let store: Record<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = {};

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = String(value);
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        },
      },
    });

    fetchMock = vi.fn();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readAccountPreferences', () => {
    it('reads the profile name and avatar', () => {
      store[PROFILE_STORAGE_KEY] = JSON.stringify({ username: 'alexandre', avatar: '/avatars/male-avatar.svg' });

      expect(readAccountPreferences()).toMatchObject({
        profileName: 'alexandre',
        profileAvatar: '/avatars/male-avatar.svg',
      });
    });

    it('reads the completion flag only when the browser also holds a real profile', () => {
      /*
       * The flag alone must NOT travel: the app writes it during a normal run, and pushing a
       * bare `true` would make the wizard unreachable on every other device.
       */
      store[ONBOARDING_COMPLETED_KEY] = 'true';
      expect(readAccountPreferences().onboardingCompleted).toBeUndefined();

      // With a real profile behind it, the flag is meaningful and must be sent.
      store[PROFILE_STORAGE_KEY] = JSON.stringify({ username: 'alexandre' });
      expect(readAccountPreferences().onboardingCompleted).toBe(true);

      store[ONBOARDING_COMPLETED_KEY] = 'false';
      expect(readAccountPreferences().onboardingCompleted).toBeUndefined();
    });

    it('does not treat an app-written default as a completed setup', () => {
      /*
       * Regression: `mcp_settings` is seeded by the MCP store at every startup. Counting it as
       * setup evidence made a fresh account look configured, so the wizard never opened.
       */
      store.mcp_settings = JSON.stringify({ maxLLMSteps: 5, webSearchEnabled: true });
      store[ONBOARDING_COMPLETED_KEY] = 'true';

      expect(readAccountPreferences().onboardingCompleted).toBeUndefined();
    });

    it('keeps interface options as the JSON string the server column expects', () => {
      const options = JSON.stringify({ accentIntensity: 70, cornerRadius: 'round' });
      store[INTERFACE_OPTIONS_STORAGE_KEY] = options;

      expect(readAccountPreferences().interfaceOptions).toBe(options);
    });

    it('skips a corrupt entry instead of losing the rest', () => {
      store[PROFILE_STORAGE_KEY] = '{not json';
      store[INTERFACE_OPTIONS_STORAGE_KEY] = JSON.stringify({ accentIntensity: 70 });

      // The profile is unreadable, but the valid interface options must still make the trip.
      expect(readAccountPreferences()).toEqual({
        interfaceOptions: JSON.stringify({ accentIntensity: 70 }),
      });
    });

    it('omits a blank name so an empty profile does not overwrite a real one', () => {
      store[PROFILE_STORAGE_KEY] = JSON.stringify({ username: '   ' });

      expect(readAccountPreferences().profileName).toBeUndefined();
    });
  });

  describe('applyAccountPreferences', () => {
    it('writes the completion flag, which is what stops a new device from re-asking', () => {
      const changed = applyAccountPreferences({ onboardingCompleted: true });

      expect(changed).toBe(true);
      expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true');
    });

    it('merges the account profile without dropping local fields', () => {
      // The local profile carries a bio the server does not store yet.
      store[PROFILE_STORAGE_KEY] = JSON.stringify({ username: 'old', bio: 'keep me' });

      applyAccountPreferences({ profileName: 'alexandre' });

      expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) as string)).toEqual({
        username: 'alexandre',
        bio: 'keep me',
      });
    });

    it('reports no change when the values already match', () => {
      store[ONBOARDING_COMPLETED_KEY] = 'true';

      expect(applyAccountPreferences({ onboardingCompleted: true })).toBe(false);
    });

    it('ignores interface options that are not valid JSON', () => {
      const changed = applyAccountPreferences({ interfaceOptions: 'not json' });

      expect(changed).toBe(false);
      expect(localStorage.getItem(INTERFACE_OPTIONS_STORAGE_KEY)).toBeNull();
    });
  });

  describe('syncAccountSettings', () => {
    it('uploads the local settings when the account is still empty', async () => {
      store[ONBOARDING_COMPLETED_KEY] = 'true';
      store[PROFILE_STORAGE_KEY] = JSON.stringify({ username: 'alexandre' });

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ ok: true, preferences: {} })) // GET
        .mockResolvedValueOnce(jsonResponse({ ok: true })); // PUT

      const result = await syncAccountSettings();

      expect(result).toBe('seeded');

      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('/api/auth/preferences');
      expect(init.method).toBe('PUT');

      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ onboardingCompleted: true, profileName: 'alexandre' });

      // Keys owned by ~/lib/preferences must not be sent from here, or the two writers race.
      for (const forbidden of ['theme', 'language', 'toolAccessMode']) {
        expect(body[forbidden]).toBeUndefined();
      }
    });

    it('adopts the account settings on a fresh device', async () => {
      // Empty browser, populated account: the exact "new phone" case.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          preferences: {
            onboardingCompleted: true,
            profileName: 'alexandre',
            interfaceOptions: JSON.stringify({ accentIntensity: 70 }),
          },
        }),
      );

      const result = await syncAccountSettings();

      expect(result).toBe('synced');
      expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true');
      expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) as string).username).toBe('alexandre');
      expect(JSON.parse(localStorage.getItem(INTERFACE_OPTIONS_STORAGE_KEY) as string).accentIntensity).toBe(70);
    });

    it('does nothing when both sides already agree', async () => {
      store[ONBOARDING_COMPLETED_KEY] = 'true';

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, preferences: { onboardingCompleted: true } }));

      expect(await syncAccountSettings()).toBe('nothing');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports offline without writing anything when the server is unreachable', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'));

      expect(await syncAccountSettings()).toBe('offline');
      expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBeNull();
    });

    it('treats a signed-out 401 as offline, not as a crash', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'not authenticated' }, 401));

      expect(await syncAccountSettings()).toBe('offline');
    });
  });

  describe('secrets', () => {
    it('reads back names only, never values', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, names: ['github_connection'] }));

      expect(await fetchSecretNames()).toEqual(['github_connection']);
    });

    it('sends only known secret names with a non-empty value', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, names: ['github_connection'] }));

      await pushSecrets({
        github_connection: '{"token":"abc"}',
        vercel_connection: '', // not configured: must not store an encrypted blank
        something_unknown: 'x', // not in the server whitelist
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;

      expect(Object.keys(body)).toEqual(['github_connection']);
    });

    it('makes no request at all when there is nothing to store', async () => {
      expect(await pushSecrets({ vercel_connection: '' })).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a 503 (no encryption key on the server) as a failure', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'not configured' }, 503));

      expect(await pushSecrets({ github_connection: 'x' })).toBe(false);
    });

    it('refuses to delete a name outside the whitelist', async () => {
      expect(await deleteSecrets(['not_a_secret'])).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deletes known names in one request', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, removed: 2 }));

      await deleteSecrets(['github_connection', 'vercel_connection']);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ names: ['github_connection', 'vercel_connection'] });
    });
  });

  describe('saveOnboardingToAccount', () => {
    it('marks the account configured once a profile exists', async () => {
      store[PROFILE_STORAGE_KEY] = JSON.stringify({ username: 'alexandre' });
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      expect(await saveOnboardingToAccount()).toBe(true);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toMatchObject({ onboardingCompleted: true, profileName: 'alexandre' });
    });

    it('never marks an empty account as configured', async () => {
      /*
       * Regression: forcing the flag here marked an untouched account as done, and because the
       * flag suppresses the wizard on every device, the setup became unreachable — including on
       * the browser that sent it.
       */
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await saveOnboardingToAccount();

      if (fetchMock.mock.calls.length) {
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))).not.toHaveProperty('onboardingCompleted');
      }
    });

    it('makes no request when there is nothing to record', async () => {
      expect(await saveOnboardingToAccount()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('restoreApiKeysFromAccount', () => {
    const ACCOUNT_KEYS = { OpenCodeGo: 'oc_sk_FROM-THE-ACCOUNT' };

    function accountHolds(value: unknown, status = 200) {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, name: 'provider_settings', value }, status));
    }

    function localKeys(): Record<string, string> {
      const raw = Cookies.get('apiKeys');

      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    }

    beforeEach(() => {
      Cookies.remove('apiKeys');
    });

    it('puts the account key in the cookie of a second device that has none', async () => {
      accountHolds(JSON.stringify(ACCOUNT_KEYS));

      expect(await restoreApiKeysFromAccount()).toBe('restored');
      expect(localKeys()).toEqual(ACCOUNT_KEYS);
    });

    it('asks the server for exactly the provider key, nothing else', async () => {
      accountHolds(JSON.stringify(ACCOUNT_KEYS));

      await restoreApiKeysFromAccount();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe('/api/auth/secrets?name=provider_settings');
    });

    it('treats the empty cookie the chat writes on mount as "no key here"', async () => {
      // The chat writes {"<provider>":""} on mount even when no key was ever entered.
      Cookies.set('apiKeys', JSON.stringify({ OpenCodeGo: '' }));
      accountHolds(JSON.stringify(ACCOUNT_KEYS));

      expect(await restoreApiKeysFromAccount()).toBe('restored');
      expect(localKeys().OpenCodeGo).toBe('oc_sk_FROM-THE-ACCOUNT');
    });

    it('never overwrites a key already typed on this device', async () => {
      Cookies.set('apiKeys', JSON.stringify({ OpenCodeGo: 'oc_sk_TYPED-HERE' }));
      accountHolds(JSON.stringify(ACCOUNT_KEYS));

      expect(await restoreApiKeysFromAccount()).toBe('nothing');
      expect(localKeys().OpenCodeGo).toBe('oc_sk_TYPED-HERE');
    });

    it('fills only the providers this device is missing and keeps the others', async () => {
      Cookies.set('apiKeys', JSON.stringify({ Anthropic: 'sk-ant-LOCAL' }));
      accountHolds(JSON.stringify({ Anthropic: 'sk-ant-ACCOUNT', OpenCodeGo: 'oc_sk_ACCOUNT' }));

      expect(await restoreApiKeysFromAccount()).toBe('restored');
      expect(localKeys()).toEqual({ Anthropic: 'sk-ant-LOCAL', OpenCodeGo: 'oc_sk_ACCOUNT' });
    });

    it('announces the restored keys so the open page picks them up', async () => {
      const heard: unknown[] = [];
      const listener = (event: Event) => heard.push((event as CustomEvent).detail);
      window.addEventListener(API_KEYS_UPDATED_EVENT, listener);
      accountHolds(JSON.stringify(ACCOUNT_KEYS));

      await restoreApiKeysFromAccount();
      window.removeEventListener(API_KEYS_UPDATED_EVENT, listener);

      expect(heard).toHaveLength(1);
      expect((heard[0] as { apiKeys: Record<string, string> }).apiKeys).toEqual(ACCOUNT_KEYS);
    });

    it('does nothing when the account holds no key', async () => {
      accountHolds(null);

      expect(await restoreApiKeysFromAccount()).toBe('nothing');
      expect(localKeys()).toEqual({});
    });

    it('ignores empty values coming from the account', async () => {
      accountHolds(JSON.stringify({ OpenCodeGo: '', Anthropic: '   ' }));

      expect(await restoreApiKeysFromAccount()).toBe('nothing');
      expect(localKeys()).toEqual({});
    });

    it.each([
      ['not JSON', 'oc_sk_not-json'],
      ['a JSON array', JSON.stringify(['oc_sk_x'])],
      ['a JSON string', JSON.stringify('oc_sk_x')],
      ['a JSON number', '42'],
    ])('refuses a stored value that is %s without touching the cookie', async (_label, value) => {
      accountHolds(value);

      expect(await restoreApiKeysFromAccount()).toBe('nothing');
      expect(localKeys()).toEqual({});
    });

    it('drops non-string entries instead of writing them as keys', async () => {
      accountHolds(JSON.stringify({ OpenCodeGo: 'oc_sk_OK', Broken: { nested: 'x' }, Count: 3 }));

      await restoreApiKeysFromAccount();

      expect(localKeys()).toEqual({ OpenCodeGo: 'oc_sk_OK' });
    });

    it('fails soft when the server is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));

      expect(await restoreApiKeysFromAccount()).toBe('offline');
      expect(localKeys()).toEqual({});
    });

    it.each([401, 403, 500])('fails soft on a %i answer and leaves the cookie alone', async (status) => {
      Cookies.set('apiKeys', JSON.stringify({ OpenCodeGo: 'oc_sk_KEEP' }));
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'nope' }, status));

      expect(await restoreApiKeysFromAccount()).toBe('offline');
      expect(localKeys().OpenCodeGo).toBe('oc_sk_KEEP');
    });

    it('does not echo a key in its log output', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      accountHolds(JSON.stringify(ACCOUNT_KEYS));

      await restoreApiKeysFromAccount();

      const everything = [warn, error, info, log].flatMap((spy) => spy.mock.calls.flat()).join(' ');
      expect(everything).not.toContain('FROM-THE-ACCOUNT');
    });
  });

  describe('storeApiKeysOnAccount', () => {
    function accountHolds(keys: Record<string, string> | null) {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          return jsonResponse({ ok: true, names: ['provider_settings'] });
        }

        return jsonResponse({ ok: true, name: 'provider_settings', value: keys ? JSON.stringify(keys) : null });
      });
    }

    function sentBody(): Record<string, string> {
      const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');

      return JSON.parse((put?.[1] as RequestInit).body as string) as Record<string, string>;
    }

    it('keeps the keys another device already stored when this one adds its own', async () => {
      accountHolds({ Anthropic: 'sk-ant-FROM-PHONE' });

      await storeApiKeysOnAccount({ OpenCodeGo: 'oc_sk_FROM-DESKTOP' });

      expect(JSON.parse(sentBody().provider_settings)).toEqual({
        Anthropic: 'sk-ant-FROM-PHONE',
        OpenCodeGo: 'oc_sk_FROM-DESKTOP',
      });
    });

    it('lets the key typed on this device replace the account value for the same provider', async () => {
      accountHolds({ OpenCodeGo: 'oc_sk_OLD' });

      await storeApiKeysOnAccount({ OpenCodeGo: 'oc_sk_NEW' });

      expect(JSON.parse(sentBody().provider_settings)).toEqual({ OpenCodeGo: 'oc_sk_NEW' });
    });

    it('never sends empty placeholders', async () => {
      accountHolds(null);

      await storeApiKeysOnAccount({ OpenCodeGo: 'oc_sk_REAL', Anthropic: '' });

      expect(JSON.parse(sentBody().provider_settings)).toEqual({ OpenCodeGo: 'oc_sk_REAL' });
    });

    it('does not write over the account when it cannot read what the account holds', async () => {
      /*
       * An unreadable account must not be treated as an empty one: that would erase every key
       * another device stored the moment this one saves.
       */
      fetchMock.mockRejectedValue(new Error('offline'));

      expect(await storeApiKeysOnAccount({ OpenCodeGo: 'oc_sk_REAL' })).toBe(false);
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
    });

    it('sends nothing when there is no key to store', async () => {
      accountHolds({ Anthropic: 'sk-ant-KEEP' });

      expect(await storeApiKeysOnAccount({ OpenCodeGo: '' })).toBe(true);
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
    });
  });

  describe('key ownership', () => {
    it('never claims a key handled by ~/lib/preferences', () => {
      for (const forbidden of ['theme', 'language', 'toolAccessMode', 'defaultModel', 'defaultProvider']) {
        expect(ACCOUNT_PREFERENCE_KEYS as readonly string[]).not.toContain(forbidden);
      }
    });
  });
});
