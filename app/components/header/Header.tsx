import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { MobilePreviewButton } from './MobilePreviewButton.client';
import { ProjectBackButton } from './ProjectBackButton.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore, toggleSidebar } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames('flex items-center gap-1 px-2 sm:px-4 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <div className="flex items-center gap-1 sm:gap-2 min-w-0 z-logo text-bolt-elements-textPrimary">
        {/*
         * Visible back control while a conversation is open (user-reported gap).
         * Renders nothing on the landing page, where there is nowhere to go back to.
         */}
        <ClientOnly>{() => <ProjectBackButton />}</ClientOnly>

        {/*
         * Sidebar toggle. This used to be a bare <div> holding an icon: no
         * onClick, no button semantics, no accessible name — it merely looked
         * like a control, so clicking it did nothing on every browser.
         */}
        <ClientOnly>{() => <SidebarToggle />}</ClientOnly>
        <a href="/" className="text-2xl font-semibold text-accent flex items-center shrink-0">
          {/* <span className="i-bolt:logo-text?mask w-[46px] inline-block" /> */}
          <img src="/logo-light-styled.png" alt="logo" className="w-[90px] inline-block dark:hidden" />
          <img src="/logo-dark-styled.png" alt="logo" className="w-[90px] inline-block hidden dark:block" />
        </a>
      </div>
      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <span className="flex-1 min-w-0 px-2 sm:px-4 truncate text-center text-sm sm:text-base text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/*
                 * "New project" — Lovable keeps a `+` next to the account on the
                 * right of the header. Same destination as the sidebar's
                 * "Start new chat" link, reachable without opening the panel.
                 */}
                <a
                  href="/"
                  data-testid="new-project"
                  aria-label="New project"
                  title="New project"
                  className={classNames(
                    'relative flex items-center justify-center rounded-full p-2 transition-colors',
                    'bg-transparent text-bolt-elements-textPrimary',
                    'hover:bg-black/[0.06] dark:hover:!bg-white/10',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
                    'active:bg-black/[0.1] dark:active:!bg-white/20',
                  )}
                >
                  <span className="i-ph:plus text-xl" aria-hidden="true" />
                </a>
                <MobilePreviewButton />
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}

/*
 * The toggle is `relative` so its enlarged ::after hit area (-inset-2) is anchored to
 * the button. Without it the pseudo-element sized itself on the page and added 8px of
 * horizontal and vertical scroll overflow.
 */
function SidebarToggle() {
  const isOpen = useStore(sidebarOpenStore);

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      aria-expanded={isOpen}
      title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      data-testid="sidebar-toggle"
      className={classNames(
        'relative flex items-center justify-center rounded-md p-1.5 transition-colors',

        /*
         * The `bg-bolt-elements-background-depth-*` tokens resolve to nothing here, so the
         * button fell back to the UA light surface and painted rgb(239,239,239) behind
         * rgb(248,248,242) ink — near-white on near-white in dark theme. Explicit surface
         * colours instead, with `!` so the dark variants win over their light twins.
         */
        'bg-transparent text-bolt-elements-textPrimary',
        'hover:bg-black/[0.06] dark:hover:!bg-white/10',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
        'active:bg-black/[0.1] dark:active:!bg-white/20',
      )}
    >
      <div
        className={classNames(
          'text-xl i-ph:sidebar-simple-duotone',

          // >44px hit area on touch: a bare 20px icon is a frustrating target.
          'after:absolute after:-inset-2 after:content-[""]',
        )}
        aria-hidden="true"
      />
    </button>
  );
}
