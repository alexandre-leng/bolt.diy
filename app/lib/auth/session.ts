/**
 * Session identity for the self-hosted Bolt.
 *
 * Authentication is entirely server-side: nginx `auth_request` asks bolt-accounts
 * (127.0.0.1:8210) whether the session cookie is valid, so the client never sees a
 * credential. This module only reads WHO is signed in, for the account UI.
 *
 * `/api/auth/me` is the source of truth. It is an API route, so an expired session comes
 * back as a plain 401 (nginx maps `/api/*` to 401 rather than an HTML redirect — see
 * `map $request_uri $bolt_is_api`), which makes the check unambiguous.
 */

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
}

export interface Session {
  /** Whether the session check has settled at least once. */
  loading: boolean;

  /** True when the server accepted the session cookie. */
  authenticated: boolean;

  /** The signed-in account, when the endpoint exposes it. */
  user: SessionUser | null;
}

export const SIGNED_OUT: Session = { loading: false, authenticated: false, user: null };

function parseUser(payload: unknown): SessionUser | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  // The endpoint answers `{ ok, user: {...} }`; tolerate a bare user object too.
  const candidate = (payload as { user?: unknown }).user ?? payload;

  if (!candidate || typeof candidate !== 'object' || typeof (candidate as SessionUser).email !== 'string') {
    return null;
  }

  const user = candidate as Partial<SessionUser>;

  return {
    id: String(user.id ?? ''),
    email: user.email as string,
    emailVerified: Boolean(user.emailVerified),
    isAdmin: Boolean(user.isAdmin),
  };
}

export async function fetchSession(signal?: AbortSignal): Promise<Session> {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      return SIGNED_OUT;
    }

    if (!response.ok) {
      /*
       * A 5xx means the client cannot tell; do not claim the user is signed out on a
       * server hiccup, or the UI would offer "sign in" to someone already signed in.
       */
      return { loading: false, authenticated: false, user: null };
    }

    const payload = (await response.json()) as unknown;
    const user = parseUser(payload);

    return { loading: false, authenticated: true, user };
  } catch {
    /*
     * A network failure is not proof of a signed-out session; report it as such rather
     * than logging the user out on a transient error.
     */
    return SIGNED_OUT;
  }
}

/**
 * Sign out. The cookie is HttpOnly, so only the server can clear it: navigate to
 * `/logout`, which ends the session and redirects to the login form. The target is a
 * constant — never assembled from user input — so this cannot become an open redirect.
 */
export function signOut(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.assign('/logout');
}

/** Best display label for a user: the local part of the address, else the whole address. */
export function displayName(user: SessionUser | null): string | null {
  if (!user?.email) {
    return null;
  }

  const local = user.email.split('@')[0];

  return local || user.email;
}
