import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
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

  /*
   * This control must NOT do what the sidebar toggle beside it does.
   *
   * Measured on the deployed build: this button called `openSidebar()`, exactly like the
   * panel toggle 4px to its right. Two adjacent icon buttons with one behaviour read as a
   * duplicate ("quand je charge une conversation, deux boutons apparaissent"), and the
   * labelled "Retour aux projets" never left the conversation it claimed to leave. It is
   * now a real link to the landing page, which is where the projects list lives.
   *
   * A link rather than a button keeps middle-click, ctrl-click and the browser's own back
   * affordance working. The workbench is closed first so a phone does not land on a
   * leftover preview overlay.
   */
  return (
    <a
      href="/"
      data-testid="back-to-projects"
      aria-label={label}
      title={label}
      onClick={() => {
        workbenchStore.showWorkbench.set(false);
      }}
      className="header-icon-control"
    >
      <span className="i-ph:caret-left text-xl" aria-hidden="true" />
    </a>
  );
}
