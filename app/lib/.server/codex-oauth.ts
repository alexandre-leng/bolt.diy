/*
 * ChatGPT/Codex OAuth for the image-generation routes.
 *
 * The subscription is a DIFFERENT backend from the API: `chatgpt.com/backend-api/codex`,
 * Responses wire format, and it authenticates with the access token produced by
 * `codex login` — never an `OPENAI_API_KEY`. This module owns that token file so the routes
 * can spend subscription credits when no platform key exists.
 *
 * Two invariants:
 *  - the refresh token ROTATES on every refresh, so the file is rewritten atomically
 *    (0600, tmp + rename) before any call uses the new pair;
 *  - a missing or unreadable file degrades silently, the caller falls back to a key.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * Resolved on EVERY call, not once at module load: process.env is populated at entrypoint time
 * (and by the test runner) and a module-level constant would freeze the path before the override
 * exists, silently reading the developer's own session.
 */
function authPath(): string {
  return process.env.CODEX_AUTH_PATH || join(homedir(), '.codex', 'auth.json');
}

const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CLIENT_VERSION = '0.155.0';

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

type CodexTokens = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  account_id?: string;
};

type CodexAuthFile = {
  auth_mode?: string;
  tokens?: CodexTokens;
  last_refresh?: string;
};

export interface CodexSession {
  accessToken: string;
  accountId?: string;
}

function loadFile(): CodexAuthFile | null {
  try {
    if (!existsSync(authPath())) {
      return null;
    }

    return JSON.parse(readFileSync(authPath(), 'utf8')) as CodexAuthFile;
  } catch {
    return null;
  }
}

/** The client id is the CLI's public one; recover it from the token instead of hardcoding. */
function clientIdFrom(idToken?: string): string | null {
  if (!idToken) {
    return null;
  }

  try {
    const part = idToken.split('.')[1];
    /* `(-part.length % 4)` is negative for some lengths (JS keeps the dividend's sign), and
     * String.repeat throws on a negative count: the catch below then reported "no session"
     * for a perfectly valid token. Pad with a non-negative count instead. */
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'));
    const aud = claims?.aud;

    return Array.isArray(aud) ? aud[0] : (aud ?? null);
  } catch {
    return null;
  }
}

function expiresAt(token?: string): number | null {
  if (!token) {
    return null;
  }

  try {
    const part = token.split('.')[1];
    /* Same padding trap as clientIdFrom: a negative repeat count throws. */
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'));

    return typeof claims?.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

/** Read the stored OAuth session, refreshing when the access token is expired or near it. */
export async function codexAuth(): Promise<CodexSession | null> {
  const file = loadFile();
  const tokens = file?.tokens;

  if (!tokens?.access_token) {
    return null;
  }

  const exp = expiresAt(tokens.access_token);
  const fresh = exp !== null && exp - Date.now() / 1000 > 120;

  if (fresh) {
    return { accessToken: tokens.access_token, accountId: tokens.account_id };
  }

  const refreshed = await refreshCodexTokens();

  return refreshed ?? { accessToken: tokens.access_token, accountId: tokens.account_id };
}

let inFlightRefresh: Promise<CodexSession | null> | null = null;

/* One refresh at a time: the token rotates, so two parallel refreshes leave one client dead. */
export function refreshCodexTokens(): Promise<CodexSession | null> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = doRefresh().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

async function doRefresh(): Promise<CodexSession | null> {
  const file = loadFile();
  const tokens = file?.tokens;

  if (!tokens?.refresh_token) {
    return null;
  }

  const clientId = process.env.CODEX_CLIENT_ID || clientIdFrom(tokens.id_token);

  if (!clientId) {
    return null;
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }).toString(),
    });

    if (!response.ok) {
      return null;
    }

    const fresh = (await response.json()) as CodexTokens;

    const next: CodexAuthFile = {
      ...file,
      tokens: {
        ...tokens,
        access_token: fresh.access_token ?? tokens.access_token,
        refresh_token: fresh.refresh_token ?? tokens.refresh_token,
        id_token: fresh.id_token ?? tokens.id_token,
      },
      last_refresh: new Date().toISOString(),
    };

    // Persist BEFORE the new token is used: the old refresh token is now dead.
    try {
      const file = authPath();
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      // read-only mount: keep the in-memory session, the next call will re-refresh
    }

    return next.tokens?.access_token
      ? { accessToken: next.tokens.access_token, accountId: next.tokens.account_id }
      : null;
  } catch {
    return null;
  }
}

/** Headers every Codex backend call needs; omitting account id or originator yields a 401. */
export function codexHeaders(session: CodexSession): Record<string, string> {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    'chatgpt-account-id': session.accountId ?? '',
    originator: 'codex_cli_rs',
    'User-Agent': `codex_cli_rs/${CLIENT_VERSION}`,
    'Content-Type': 'application/json',
  };
}
