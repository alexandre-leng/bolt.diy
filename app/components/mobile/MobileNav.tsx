import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { chatStore } from '~/lib/stores/chat';
import { closeSidebar, openSidebar, sidebarOpenStore } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';

/** Event the sidebar Menu listens to, so this bar can open the settings panel. */
export const OPEN_SETTINGS_EVENT = 'bolt:open-settings';

/** Ask the sidebar Menu to open the settings panel, optionally on a given tab. */
export function requestOpenSettings(tab?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab } }));
}

type Tab = 'home' | 'projects' | 'settings';

/*
 * Floating bottom navigation for phones (< 768px).
 *
 * Design rules, measured on the deployed build rather than eyeballed:
 * - the pill is OPAQUE. A translucent surface over the pink landing wash let the
 *   background bleed through and washed the icons out on a real phone.
 * - inactive ink is the full text colour (~17:1 on the pill), not a tint: a tinted
 *   label at 11px failed the "readable small text" bar.
 * - labels are 11px, not 9px: below ~11px the cap height is under 8px.
 * - targets are 48px tall, above the 44px WCAG 2.5.5 minimum.
 * - the bar must not obscure content: the landing screen reserves
 *   --mobile-nav-space at the bottom (see index.scss).
 *
 * Shown on the landing screens only: during a conversation the composer owns
 * the bottom of the screen, as in Lovable. Above the projects sidebar; hidden
 * whenever the settings dialog is open so it cannot overlay dialog content.
 */
export function MobileNav() {
  const { started } = useStore(chatStore);
  const projectsOpen = useStore(sidebarOpenStore);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onSettingsChange = (event: Event) => {
      setSettingsOpen((event as CustomEvent<{ open: boolean }>).detail.open);
    };

    window.addEventListener('bolt:settings-visibility', onSettingsChange);

    return () => window.removeEventListener('bolt:settings-visibility', onSettingsChange);
  }, []);

  if (started || settingsOpen) {
    return null;
  }

  const active: Tab = projectsOpen ? 'projects' : 'home';

  // Icon classes are written out in full: UnoCSS extracts them statically.
  const items: { id: Tab; label: string; icon: string; activeIcon: string; onSelect: () => void }[] = [
    {
      id: 'home',
      label: 'Accueil',
      icon: 'i-ph:house-simple',
      activeIcon: 'i-ph:house-simple-fill',
      onSelect: closeSidebar,
    },
    {
      id: 'projects',
      label: 'Projets',
      icon: 'i-ph:squares-four',
      activeIcon: 'i-ph:squares-four-fill',
      onSelect: openSidebar,
    },
    {
      id: 'settings',
      label: 'Réglages',
      icon: 'i-ph:gear-six',
      activeIcon: 'i-ph:gear-six-fill',
      onSelect: () => requestOpenSettings(),
    },
  ];

  return (
    <nav
      aria-label="Navigation principale"
      data-testid="mobile-nav"
      className={classNames(
        'md:hidden fixed inset-x-0 bottom-0 z-[998] flex justify-center px-3',
        'pointer-events-none pb-[calc(0.625rem+env(safe-area-inset-bottom))]',
      )}
    >
      <ul
        className={classNames(
          'pointer-events-auto flex items-stretch gap-1.5 rounded-full p-1.5',
          'border border-black/10 bg-white shadow-[0_12px_32px_-12px_rgba(16,24,40,0.45)]',

          /*
           * `!` on the dark variants is required: UnoCSS emits `.bg-white, [data-theme="dark"]
           * .dark\:bg-white` as ONE rule with equal specificity, so a plain `dark:bg-*` lost
           * to `bg-white` and the bar stayed white in dark mode (white text on white).
           */
          'dark:!border-white/15 dark:!bg-[#18181b]',
        )}
      >
        {items.map((item) => {
          const isActive = item.id === active;

          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={item.onSelect}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                data-tab={item.id}
                className={classNames(
                  'flex h-12 min-w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-full px-3',
                  'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
                  isActive
                    ? /*
                       * Active: solid ink fill, not `bg-accent-500`. The app's accent-intensity
                       * preference paints the accent token with alpha (measured: 50%), which left
                       * white text at ~2.5:1. An opaque fill keeps the active tab above 17:1 in
                       * both themes and reads the same whatever the accent setting is.
                       * `!` for the same specificity reason as the pill above.
                       */
                      'bg-[#1c1c1c] text-white shadow-sm dark:!bg-white dark:!text-[#1c1c1c]'
                    : /*
                       * Inactive: transparent background is REQUIRED, not cosmetic. A <button>
                       * carries a light UA background; with no explicit value the inactive chip
                       * painted rgb(239,239,239) inside the dark pill, and light ink on it was
                       * invisible. Full-strength ink, never a washed-out tint.
                       */
                      'bg-transparent text-[#1c1c1c] hover:bg-black/[0.06] dark:!text-white/85 dark:hover:!bg-white/10',
                )}
              >
                <span
                  className={classNames(isActive ? item.activeIcon : item.icon, 'text-[18px]')}
                  aria-hidden="true"
                />
                <span
                  aria-hidden="true"
                  className={classNames(
                    'text-[11px] leading-none tracking-tight',
                    isActive ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
