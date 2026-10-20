import { useStore } from '@nanostores/react';
import { useNavigate } from 'react-router';
import { chatStore } from '~/lib/stores/chat';
import { closeSidebar } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * Visible "back" control inside a conversation.
 *
 * What it must NOT do: open the history panel. It used to call `openSidebar()`, so one click
 * ran two commands and the label promised a destination it never reached — the user stayed on
 * the same chat with a panel over it, and that panel already had two other ways to open it.
 *
 * What it does now: leaves the conversation (`/` shows the prompt plus "Vos conversations"),
 * closes the preview so a phone lands on a usable surface instead of a split screen, and hides
 * the panel so the landing page is not half covered by a list the user just left.
 */
export function ProjectBackButton() {
  const { started } = useStore(chatStore);
  const navigate = useNavigate();

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
        closeSidebar();
        navigate('/');
      }}
      className="header-icon-control"
    >
      <span className="i-ph:caret-left text-xl" aria-hidden="true" />
    </button>
  );
}
