import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import { openSidebar } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * Visible "back" control (user-reported: "il faut que les boutons apparents de
 * retour soient disponibles").
 *
 * Measured on the deployed build: inside a conversation the header held only
 * the sidebar toggle and the logo <a href="/">. No chevron, no label, desktop
 * OR phone — the logo was the only way out and nothing marked it clickable.
 * A user landing on /chat/<id> had no explicit way back to the projects list.
 *
 * This renders one labelled chevron that returns to the projects list. It also
 * closes the workbench, so on a phone it lands on a usable surface rather than
 * leaving the preview open over the chat.
 */
export function ProjectBackButton() {
  const { started } = useStore(chatStore);

  if (!started) {
    return null;
  }

  const label = 'Retour aux projets';

  return (
    <button
      type="button"
      data-testid="back-to-projects"
      aria-label={label}
      title={label}
      onClick={() => {
        workbenchStore.showWorkbench.set(false);
        openSidebar();
      }}
      className="header-icon-control"
    >
      <span className="i-ph:caret-left text-xl" aria-hidden="true" />
    </button>
  );
}
