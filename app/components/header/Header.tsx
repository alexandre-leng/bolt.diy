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
      data-testid="app-header"
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
       *
       * `z-above-sidebar` is deliberate: the sidebar is a `fixed` panel at z-index 997 and the
       * header is static, so when the panel opened it covered this whole cluster except the
       * logo (the only child that carried a z-index). The header toggle then promised to close
       * a panel it was buried under. This cluster holds the one toggle and the one back control,
       * so it must stay painted above the panel.
       */}
      <div className="flex items-center gap-1 min-w-0 z-above-sidebar text-bolt-elements-textPrimary">
        {/*
         * No back control here: the user removed it as redundant. The logo already returns to the
         * landing page (it is a link, labelled), and the sidebar leads to the conversation list.
         * `ProjectBackButton` is kept in the repository but no longer mounted.
         */}

        {/*
         * Sidebar toggle: the ONLY control that opens and closes the panel. It used to compete
         * with three others (a close button inside the panel, a floating chevron pinned to the
         * left edge on desktop, and the "back to projects" chevron which silently opened the
         * panel), so one intention had four handles and two of them showed the same chevron for
         * opposite actions. The icon now states the action instead of the widget type.
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
      {chat.started && ( // Display the chat label on desktop only; phone space belongs to the controls.
        <>
          <span className="hidden sm:flex flex-1 min-w-0 px-2 sm:px-4 truncate text-center text-sm sm:text-base text-bolt-elements-textPrimary">
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
/*
 * Two controls sit side by side here and they mean different things, so they must not look
 * alike. Measured on the deployed build: both were 36px round buttons 4px apart, and the
 * sidebar glyph (a panel with a separator drawn on its left edge) reads as a second back
 * chevron at 20px. Two fixes, not one:
 *
 * 1. The control that OPENS the panel draws a list glyph (`i-ph:list-dashes`), which has no
 *    direction in it: nothing on the left edge can be mistaken for "go back".
 * 2. The two are separated by a hairline. A gap alone did not communicate "different family";
 *    a rule does, and it also anchors the toggle to the side of the panel it controls.
 *
 * When the panel is open the toggle becomes a close control and draws `caret-left`, but the
 * back control is hidden from the eye by the panel by then, so the glyphs never compete.
 */
function SidebarToggle() {
  const isOpen = useStore(sidebarOpenStore);
  const label = isOpen ? 'Fermer le panneau' : 'Ouvrir le panneau';

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={label}
      aria-expanded={isOpen}
      aria-controls="sidebar-panel"
      title={label}
      data-testid="sidebar-toggle"
      className="header-icon-control"
    >
      <span className={classNames('text-xl', isOpen ? 'i-ph:x' : 'i-ph:list-dashes')} aria-hidden="true" />
    </button>
  );
}
