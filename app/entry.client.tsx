import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import '~/utils/clearLocks';
import { restoreApiKeysFromAccount, syncAccountSettings } from '~/lib/accountSettings';
import { syncPreferences } from '~/lib/preferences';
import { installStaleChunkReload } from '~/lib/staleChunkReload';
import { setTheme } from '~/lib/stores/theme';
import { THEMES, type Theme } from '~/types/theme';

installStaleChunkReload();

/*
 * Bring the account's provider key to this device. Without it a second device is told a key
 * exists on the account but never receives it, and every model request then fails for want of
 * one. Not awaited (the render must not wait on the network); the open page is told through
 * the API-keys event, which reloads the model list for the restored provider.
 */
void restoreApiKeysFromAccount();

/*
 * Pull this account's settings from the server once per page load.
 *
 * Two modules, because they own different keys: ~/lib/preferences handles theme and
 * language, this one handles the profile, the onboarding flag and the appearance choices.
 * Both are deliberately not awaited — the render must not wait on the network, and on a
 * first visit the browser's own values are uploaded instead.
 */
void syncAccountSettings().then((result) => {
  if (result === 'synced' || result === 'seeded') {
    /*
     * The appearance choices are applied by the inline script in the document head, which ran
     * before these server values arrived. Re-apply them so a device that just adopted the
     * account's settings does not keep showing its own.
     */
    try {
      const options = JSON.parse(localStorage.getItem('bolt_interface_options') || '{}');
      const root = document.documentElement;

      if (typeof options.accentIntensity === 'number') {
        root.dataset.accentIntensity = String(options.accentIntensity);
        root.style.setProperty('--interface-accent-strength', `${options.accentIntensity}%`);
      }

      if (['sharp', 'soft', 'round'].includes(options.cornerRadius)) {
        root.dataset.cornerRadius = options.cornerRadius;
      }

      if (typeof options.compactMode === 'boolean') {
        root.dataset.compactMode = String(options.compactMode);
      }

      if (typeof options.animatedTransitions === 'boolean') {
        root.dataset.animatedTransitions = String(options.animatedTransitions);
      }
    } catch {
      // A malformed entry is not worth failing the boot over; the defaults still apply.
    }
  }
});

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

    if (theme && (theme === 'dark' || THEMES.some(({ id }) => id === theme))) {
      setTheme(theme as Theme);
    }
  }
});

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
