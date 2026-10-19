import { profileStore, updateProfile } from '~/lib/stores/profile';

/*
 * Server-side persistence for the profile panel.
 *
 * The panel used to write to `localStorage` only and then show "./Name updated" without sending
 * anything: the display name was lost on any other device, and the server-side row never moved.
 * The endpoint exists (`PATCH /api/auth/profile`, accounts service) and honours a real PATCH — an
 * omitted field keeps its stored value — so the client is the only missing link.
 *
 * The store stays the hero for responsiveness; the server call is what makes the value durable, and
 * the success toast is only shown after the server accepted it.
 */

/** The fields the accounts service accepts. `username` maps to its `displayName`. */
export type PersistableField = 'username' | 'bio';

/** Wire name for each local field, so the mapping lives in exactly one place. */
const FIELD_TO_BODY = {
  username: 'displayName',
  bio: 'bio',
} as const satisfies Record<PersistableField, string>;

export interface PersistResult {
  ok: boolean;

  /** Present when the server refused; safe to show, never carries SQL or the user's own content. */
  error?: string;
}

/**
 * Send one field to the accounts service.
 *
 * Never throws: the caller shows a toast and must be able to distinguish success from failure, so a
 * network error is reported as `{ ok: false }` rather than escaping as an exception.
 */
export async function persistProfileField(field: PersistableField, value: string): Promise<PersistResult> {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Not available during server rendering' };
  }

  try {
    const response = await fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },

      // A real PATCH: only the edited field travels, so the other one keeps its stored value.
      body: JSON.stringify({ [FIELD_TO_BODY[field]]: value }),
    });

    if (!response.ok) {
      return { ok: false, error: `The server refused the change (${response.status})` };
    }

    return { ok: true };
  } catch (error) {
    console.error('Failed to persist profile field:', error);

    return { ok: false, error: 'Could not reach the server' };
  }
}

/**
 * Fill the store from what the account already holds, without overwriting a value the user typed.
 *
 * The panel rendered an empty field for an account whose `display_name` was set, because the store
 * only ever read `localStorage`. Values already in the store win: they may be an unsaved edit.
 */
export function hydrateProfileFromAccount(account: { displayName?: string | null; bio?: string | null } | null): void {
  if (!account) {
    return;
  }

  const current = profileStore.get();
  const next: Partial<{ username: string; bio: string }> = {};

  if (!current.username && account.displayName) {
    next.username = account.displayName;
  }

  if (!current.bio && account.bio) {
    next.bio = account.bio;
  }

  if (Object.keys(next).length > 0) {
    updateProfile(next);
  }
}
