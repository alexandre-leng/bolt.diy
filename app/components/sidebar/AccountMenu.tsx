import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';
import { displayName, fetchSession, signOut, type Session } from '~/lib/auth/session';
import { DEFAULT_AVATAR, profileStore } from '~/lib/stores/profile';
import { classNames } from '~/utils/classNames';

/**
 * Account control for the sidebar footer: shows who is signed in, links to the personal
 * space, and offers a sign-out.
 *
 * The sign-in page itself is server-rendered (nginx -> bolt-accounts) because credentials
 * must never reach the client bundle; this component is the in-app counterpart and
 * deliberately mirrors that page's vocabulary ("Se connecter" / "Se déconnecter").
 */
/*
 * Menu entries share one set of classes: the settings link, the sign-out button and the
 * sign-in link must look identical in every theme.
 *
 * `bg-transparent` is NOT cosmetic here. Without it the browser paints its native button
 * background — measured `rgb(239, 239, 239)` on Chromium — while `textPrimary` is the
 * theme's own colour. In a dark theme that reads as near-white text on a light-grey pill,
 * a contrast of about 1:1 against a 4.5:1 requirement. An <a> is unaffected, which is why
 * only the button was reported: "Mon compte" looked fine and "Se déconnecter" did not.
 */
const MENU_ITEM_CLASSES = classNames(
  'text-bolt-elements-textPrimary flex w-full items-center gap-2 bg-transparent',
  'rounded-md px-3 py-2 text-left text-sm transition-colors appearance-none',
  'hover:bg-bolt-elements-background-depth-3',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
);

export function AccountMenu() {
  const profile = useStore(profileStore);
  const [session, setSession] = useState<Session>({ loading: true, authenticated: false, user: null });
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchSession(controller.signal).then(setSession);

    return () => controller.abort();
  }, []);

  // Close on outside click and on Escape, like the other menus in the panel.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label = displayName(session.user) || profile?.username || 'Invité';

  const handleSignOut = () => {
    setSigningOut(true);
    signOut();
  };

  return (
    <div ref={containerRef} className="relative" data-testid="account-menu">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Compte de ${label}`}
        data-testid="account-menu-trigger"

        /*
         * The surface was implicit, so the browser painted its default light-grey button
         * background on the panel's dark header in BOTH themes. Be explicit about it.
         */
        className={classNames(
          'flex items-center gap-2 rounded-full bg-transparent px-1.5 py-1 text-left transition-colors',
          'hover:bg-black/[0.06] dark:hover:bg-white/10',
          'active:bg-black/[0.1] dark:active:bg-white/20',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
        )}
      >
        <span className="text-bolt-elements-textPrimary max-w-[7rem] truncate text-sm font-medium">{label}</span>
        <div className="bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary flex h-[32px] w-[32px] shrink-0 items-center justify-center overflow-hidden rounded-full">
          <img
            src={profile?.avatar || DEFAULT_AVATAR}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            decoding="sync"
          />
        </div>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="account-menu-panel"
          className={classNames(
            'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor absolute right-0 top-full z-50 mt-1 w-60',
            'rounded-lg border p-1 shadow-lg',
          )}
        >
          <div className="border-bolt-elements-borderColor border-b px-3 py-2">
            <p className="text-bolt-elements-textPrimary truncate text-sm font-medium">
              {session.user?.email || profile?.username || 'Invité'}
            </p>
            <p className="text-bolt-elements-textTertiary text-xs">
              {session.loading ? 'Vérification…' : session.authenticated ? 'Connecté' : 'Non connecté'}
            </p>
            {session.user?.isAdmin && (
              <span
                data-testid="account-admin-badge"
                className="bg-accent-500/15 text-bolt-elements-textPrimary mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
              >
                <span className="i-ph:shield-check h-3 w-3" aria-hidden="true" />
                Administrateur
              </span>
            )}
          </div>

          {session.authenticated ? (
            <>
              <a role="menuitem" href="/settings" data-testid="account-settings" className={MENU_ITEM_CLASSES}>
                <span className="i-ph:gear-six h-4 w-4" aria-hidden="true" />
                Mon compte
              </a>
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                disabled={signingOut}
                data-testid="account-signout"
                className={classNames(MENU_ITEM_CLASSES, 'disabled:opacity-60')}
              >
                <span className="i-ph:sign-out h-4 w-4" aria-hidden="true" />
                {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
              </button>
            </>
          ) : (
            <a role="menuitem" href="/login" data-testid="account-signin" className={MENU_ITEM_CLASSES}>
              <span className="i-ph:sign-in h-4 w-4" aria-hidden="true" />
              Se connecter
            </a>
          )}
        </div>
      )}
    </div>
  );
}
