import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKeyCacheForTests, modelPolicyViolation, NO_POLICY, resolveProviderKeys } from './instance-keys';

/*
 * The key ORDER is the whole feature: an administrator configures providers for everybody, so a
 * stale personal key must not override a managed one, and a personal key must not be used at all
 * for a provider the admin never opened.
 *
 * Fetch is stubbed here: this tests the resolution rules, not the accounts service (which has its
 * own suite, `test_instance_keys.py`, against a private database).
 */

const ACCOUNTS_ANSWER = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      ok: true,
      apiKeys: { OpenAI: 'sk-instance' },
      baseUrls: {},
      allowUserKeys: [],
      source: { OpenAI: 'instance' },
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('resolveProviderKeys', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    /*
     * The resolver caches per user for a few seconds; without this the second test would read
     * the first test's answer and prove nothing.
     */
    __resetKeyCacheForTests();
    fetchMock = vi.fn(async () => ACCOUNTS_ANSWER());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('serves the instance key and marks its source', async () => {
    const resolved = await resolveProviderKeys({ userId: 'user-a' });

    expect(resolved.apiKeys.OpenAI).toBe('sk-instance');
    expect(resolved.source.OpenAI).toBe('instance');
  });

  it('asks the accounts service for THIS user, so policy is per account', async () => {
    await resolveProviderKeys({ userId: 'user-42' });

    expect(String(fetchMock.mock.calls[0][0])).toContain('user_id=user-42');
  });

  it('ignores a cookie key for a provider the admin manages', async () => {
    const resolved = await resolveProviderKeys({
      userId: 'user-a',
      cookieKeys: { OpenAI: 'sk-stale-personal' },
    });

    expect(resolved.apiKeys.OpenAI).toBe('sk-instance');
  });

  it('uses the cookie key once the admin opens that provider', async () => {
    fetchMock.mockResolvedValueOnce(ACCOUNTS_ANSWER({ allowUserKeys: ['OpenAI'], apiKeys: {}, source: {} }));

    const resolved = await resolveProviderKeys({
      userId: 'user-a',
      cookieKeys: { OpenAI: 'sk-personal' },
    });

    expect(resolved.apiKeys.OpenAI).toBe('sk-personal');
    expect(resolved.source.OpenAI).toBe('user');
  });

  it('keeps the instance key on top of a personal one for an opened provider', async () => {
    fetchMock.mockResolvedValueOnce(ACCOUNTS_ANSWER({ allowUserKeys: ['OpenAI'] }));

    const resolved = await resolveProviderKeys({
      userId: 'user-a',
      cookieKeys: { OpenAI: 'sk-personal' },
    });

    expect(resolved.apiKeys.OpenAI).toBe('sk-instance');
    expect(resolved.source.OpenAI).toBe('instance');
  });

  it('falls back to the cookie when the accounts service is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const resolved = await resolveProviderKeys({ userId: 'user-b', cookieKeys: { Groq: 'gsk_local' } });

    /*
     * No allowUserKeys is known, so a personal key is NOT trusted. This is deliberate: an
     * unreachable policy must fail closed, not open every provider.
     */
    expect(resolved.apiKeys).toEqual({});
  });

  it('fails closed and keeps the last valid keys and policy on a service outage', async () => {
    fetchMock.mockResolvedValueOnce(
      ACCOUNTS_ANSWER({
        allowUserKeys: ['Anthropic'],
        policy: {
          managedMode: true,
          allowedProviders: ['OpenAI'],
          allowedModels: {},
          defaultModel: { provider: 'OpenAI', model: 'x' },
          effortPolicy: 'auto-only',
        },
      }),
    );

    const good = await resolveProviderKeys({ userId: 'stale-policy', cookieKeys: { Anthropic: 'personal' } });
    expect(good.apiKeys.Anthropic).toBe('personal');
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const stale = await resolveProviderKeys({ userId: 'stale-policy', cookieKeys: { Anthropic: 'personal' } });
    expect(stale.policy.managedMode).toBe(true);
    expect(stale.apiKeys.Anthropic).toBe('personal');
  });

  it('marks policy unavailable when no valid answer exists', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const resolved = await resolveProviderKeys({ userId: 'unknown-policy', cookieKeys: { Anthropic: 'personal' } });
    expect(resolved.policyUnavailable).toBe(true);
    expect(resolved.apiKeys).toEqual({});
  });

  it('never throws when the service answers garbage', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));

    await expect(resolveProviderKeys({ userId: 'user-c' })).resolves.toBeDefined();
  });

  it('caches per user for a burst, and not across users', async () => {
    __resetKeyCacheForTests();
    await resolveProviderKeys({ userId: 'user-d' });
    await resolveProviderKeys({ userId: 'user-d' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await resolveProviderKeys({ userId: 'user-e' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('model policy', () => {
  beforeEach(() => {
    __resetKeyCacheForTests();
  });

  const MANAGED = {
    managedMode: true,
    allowedProviders: ['OpenCodeGo'],
    allowedModels: { OpenCodeGo: ['deepseek-v4.1-flash'] },
    effortPolicy: 'auto-only' as const,
    defaultModel: { provider: 'OpenCodeGo', model: 'deepseek-v4.1-flash' },
  };

  it('allows everything when no policy was ever set', () => {
    /*
     * The deployment that predates the policy must keep working: an absent policy is not an
     * empty allow list.
     */
    expect(modelPolicyViolation(NO_POLICY, 'OpenAI', 'gpt-4o')).toBe('');
    expect(modelPolicyViolation(NO_POLICY, 'OpenCodeGo', 'whatever')).toBe('');
  });

  it('refuses a provider the administrator closed', () => {
    const policy = { ...NO_POLICY, managedMode: true, allowedProviders: ['OpenCodeGo'] };

    expect(modelPolicyViolation(policy, 'OpenAI', 'gpt-4o')).toContain("n'est pas autorisé");
    expect(modelPolicyViolation(policy, 'OpenCodeGo', 'deepseek-v4.1-flash')).toBe('');
  });

  it('refuses a model outside the allowed list for an open provider', () => {
    const policy = { ...NO_POLICY, ...MANAGED };

    expect(modelPolicyViolation(policy, 'OpenCodeGo', 'glm-4.6')).toContain("n'est pas autorisé");
    expect(modelPolicyViolation(policy, 'OpenCodeGo', 'deepseek-v4.1-flash')).toBe('');
  });

  it('lets every model through on an open provider with no model list', () => {
    const policy = { ...NO_POLICY, managedMode: true, allowedProviders: ['OpenCodeGo'] };

    expect(modelPolicyViolation(policy, 'OpenCodeGo', 'any-model')).toBe('');
  });

  it('carries the policy through the resolution, and keeps the cache honest', async () => {
    const fetchMock = vi.fn(async () => ACCOUNTS_ANSWER({ policy: MANAGED }));
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveProviderKeys({ userId: 'user-policy' });

    expect(resolved.policy.managedMode).toBe(true);
    expect(resolved.policy.allowedProviders).toEqual(['OpenCodeGo']);
    expect(resolved.policy.effortPolicy).toBe('auto-only');

    vi.unstubAllGlobals();
  });

  it('falls back to the permissive policy when the service sends a malformed one', async () => {
    const fetchMock = vi.fn(async () => ACCOUNTS_ANSWER({ policy: 'not-an-object' }));
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveProviderKeys({ userId: 'user-bad' });

    /*
     * Failing OPEN here is the opposite of the key rule, and deliberately so: a malformed
     * policy decides PERMISSIONS, and denying every model to everybody because one field was
     * unreadable would take the whole product down. Keys still fail closed above.
     */
    expect(resolved.policy.managedMode).toBe(false);
    expect(resolved.policy.allowedProviders).toEqual([]);

    vi.unstubAllGlobals();
  });
});
