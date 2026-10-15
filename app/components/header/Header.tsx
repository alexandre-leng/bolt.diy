import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { MobilePreviewButton } from './MobilePreviewButton.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore, toggleSidebar } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames('flex items-center px-4 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary">
        {/*
         * Sidebar toggle. This used to be a bare <div> holding an icon: no
         * onClick, no button semantics, no accessible name — it merely looked
         * like a control, so clicking it did nothing on every browser.
         */}
        <ClientOnly>{() => <SidebarToggle />}</ClientOnly>
        <a href="/" className="text-2xl font-semibold text-accent flex items-center">
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
              <div className="flex items-center gap-2">
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
        'text-bolt-elements-textPrimary',
        'hover:bg-bolt-elements-background-depth-2',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
        'active:bg-bolt-elements-background-depth-3',
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
