import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import '~/utils/clearLocks';
import { syncPreferences } from '~/lib/preferences';
import { installStaleChunkReload } from '~/lib/staleChunkReload';

installStaleChunkReload();

/*
 * Pull this account's preferences from the server once per page load.
 *
 * Runs before hydration finishes so a fresh device picks up the account's theme instead of
 * flashing the default. Deliberately not awaited: the render must not wait on the network, and
 * on a first visit (nothing stored yet) the browser's own choices are uploaded instead.
 */
void syncPreferences().then((result) => {
  if (result === 'synced' || result === 'seeded') {
    // Re-apply the theme attribute: the inline script ran before the server values arrived.
    const theme = localStorage.getItem('bolt_theme');

    if (theme) {
      const mode = theme.startsWith('dark') ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', mode);
      document.documentElement.setAttribute('data-color-theme', theme === 'dark' ? 'dark-dracula' : theme);
    }
  }
});

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
