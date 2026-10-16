import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayName, fetchSession, signOut, SIGNED_OUT } from '~/lib/auth/session';

/**
 * The session module is the only client-side place that decides "am I signed in?".
 * Its failure modes matter: a false negative silently logs the user out of the UI, and a
 * redirect that reaches `location.assign` with an attacker-controlled target would be an
 * open redirect. Both are pinned below.
 */
describe('fetchSession', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockFetch = (impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
    globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  const user = { id: 'u1', email: 'alexandre@lengereau.fr', emailVerified: true, isAdmin: true };

  it('reads the signed-in account from /api/auth/me', async () => {
    mockFetch(async () => new Response(JSON.stringify({ ok: true, user }), { status: 200 }));

    const session = await fetchSession();

    expect(session.authenticated).toBe(true);
    expect(session.user).toEqual(user);
  });

  it('reports an expired session as signed out', async () => {
    // nginx maps /api/* to a plain 401 instead of an HTML redirect.
    mockFetch(async () => new Response(null, { status: 401 }));

    await expect(fetchSession()).resolves.toEqual(SIGNED_OUT);
  });

  it('treats a suspended account (403) as signed out', async () => {
    mockFetch(async () => new Response(null, { status: 403 }));

    await expect(fetchSession()).resolves.toEqual(SIGNED_OUT);
  });

  it('never throws when the request fails', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchSession()).resolves.toEqual(SIGNED_OUT);
  });

  it('does not invent a user from an unexpected payload', async () => {
    mockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const session = await fetchSession();

    expect(session.authenticated).toBe(true);
    expect(session.user).toBeNull();
  });

  it('accepts a bare user object as well as a wrapped one', async () => {
    mockFetch(async () => new Response(JSON.stringify(user), { status: 200 }));

    const session = await fetchSession();

    expect(session.user?.isAdmin).toBe(true);
  });

  it('leaves admin false when the flag is absent', async () => {
    mockFetch(
      async () => new Response(JSON.stringify({ user: { id: 'u2', email: 'someone@example.com' } }), { status: 200 }),
    );

    const session = await fetchSession();

    expect(session.user?.isAdmin).toBe(false);
  });
});

describe('displayName', () => {
  it('uses the local part of the address', () => {
    expect(displayName({ id: 'u', email: 'alexandre@lengereau.fr', emailVerified: true, isAdmin: true })).toBe(
      'alexandre',
    );
  });

  it('returns null without a user', () => {
    expect(displayName(null)).toBeNull();
  });
});

describe('signOut', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // jsdom's location is not directly assignable; replace the whole object.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, assign: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  });

  it('navigates to the server logout endpoint only', () => {
    signOut();

    expect(window.location.assign).toHaveBeenCalledWith('/logout');
  });

  it('never forwards a caller-supplied target', () => {
    /*
     * Guards against someone later threading a `next` through and creating an open
     * redirect out of the sign-out path.
     */
    const assign = window.location.assign as unknown as ReturnType<typeof vi.fn>;

    signOut();

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toBe('/logout');
  });
});
