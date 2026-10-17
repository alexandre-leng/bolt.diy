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
      className={classNames(
        'flex items-center gap-2 px-2 sm:px-4 border-b h-[var(--header-height)]',

        /* The landing page has no chrome: a bottom border there reads as a stray line. */
        { 'border-transparent': !chat.started, 'border-bolt-elements-borderColor': chat.started },
      )}
    >
      {/*
       * Left cluster. One gap for the whole group (`gap-1`) so the back control, the
       * sidebar toggle and the logo read as a single unit instead of three items placed
       * by accident: measured before this change, the internal gaps were 8 / 8 / 630 px.
       */}
      <div className="flex items-center gap-1 min-w-0 z-logo text-bolt-elements-textPrimary">
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

        {/*
         * The logo is the only way back to the landing page, and it is an image: without a
         * label it had no accessible name at all (measured: hasLabel false, text empty).
         */}
        <a
          href="/"
          aria-label="Accueil bolt.diy"
          title="Accueil bolt.diy"
          className="flex items-center shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
        >
          <img src="/logo-light-styled.png" alt="bolt.diy" className="w-[90px] inline-block dark:hidden" />
          <img
            src="/logo-dark-styled.png"
            alt=""
            aria-hidden="true"
            className="w-[90px] inline-block hidden dark:block"
          />
        </a>
      </div>
      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <span className="flex-1 min-w-0 px-2 sm:px-4 truncate text-center text-sm sm:text-base text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="flex items-center gap-1 shrink-0">
                {/*
                 * "New project" — Lovable keeps a `+` next to the account on the
                 * right of the header. Same destination as the sidebar's
                 * "Start new chat" link, reachable without opening the panel.
                 */}
                <a
                  href="/"
                  data-testid="new-project"
                  aria-label="Nouveau projet"
                  title="Nouveau projet"
                  className="header-icon-control"
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
 * One control geometry for the whole bar.
 *
 * Measured before this change, the header mixed three sizes (32, 36 and a bare icon) and
 * three radii (9999px, 6px, 0px), so the controls never lined up. Every icon control now
 * shares this class: a 36px round target, transparent surface, and the same hover/active
 * step. It lives in the stylesheet because UnoCSS extracts classes statically and a shared
 * string keeps the two controls from drifting apart again.
 */
function SidebarToggle() {
  const isOpen = useStore(sidebarOpenStore);

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={isOpen ? 'Fermer le panneau' : 'Ouvrir le panneau'}
      aria-expanded={isOpen}
      title={isOpen ? 'Fermer le panneau' : 'Ouvrir le panneau'}
      data-testid="sidebar-toggle"
      className="header-icon-control"
    >
      <span className="i-ph:sidebar-simple-duotone text-xl" aria-hidden="true" />
    </button>
  );
}
