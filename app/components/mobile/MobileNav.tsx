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
 * Lovable-style floating bottom navigation for phones (< 768px).
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
      label: 'Home',
      icon: 'i-ph:house-simple',
      activeIcon: 'i-ph:house-simple-fill',
      onSelect: closeSidebar,
    },
    {
      id: 'projects',
      label: 'Projects',
      icon: 'i-ph:squares-four',
      activeIcon: 'i-ph:squares-four-fill',
      onSelect: openSidebar,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'i-ph:gear-six',
      activeIcon: 'i-ph:gear-six-fill',
      onSelect: () => requestOpenSettings(),
    },
  ];

  return (
    <nav
      aria-label="Main"
      data-testid="mobile-nav"
      className="md:hidden fixed inset-x-0 bottom-0 z-[998] flex justify-center px-4 pointer-events-none pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      {/* Lovable: translucent pastel-pink glass pill; active tab = filled icon on a lighter chip. */}
      <ul className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/60 dark:border-white/10 bg-pink-100/70 dark:bg-white/10 backdrop-blur-xl p-1.5 shadow-[0_8px_24px_-8px_rgba(190,24,93,0.35)]">
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
                  'flex h-11 min-w-14 flex-col items-center justify-center rounded-full px-2 text-[19px] leading-none transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
                  isActive
                    ? 'bg-white/85 dark:bg-white/15 text-[#1c1c1c] dark:text-white shadow-xs'
                    : 'text-[#1c1c1c]/70 dark:text-white/70 hover:text-[#1c1c1c] dark:hover:text-white',
                )}
              >
                <span className={isActive ? item.activeIcon : item.icon} aria-hidden="true" />
                <span aria-hidden="true" className="mt-0.5 text-[9px] font-medium tracking-tight">
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
