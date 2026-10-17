import { useStore } from '@nanostores/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import WithTooltip from '~/components/ui/Tooltip';
import { useEditChatDescription } from '~/lib/hooks';
import { description as descriptionStore } from '~/lib/persistence';

export function ChatDescription() {
  const initialDescription = useStore(descriptionStore)!;

  const { editing, handleChange, handleBlur, handleSubmit, handleKeyDown, currentDescription, toggleEditMode } =
    useEditChatDescription({
      initialDescription,
      syncWithGlobalStore: true,
    });

  if (!initialDescription) {
    // doing this to prevent showing edit button until chat description is set
    return null;
  }

  return (
    <div className="flex items-center justify-center">
      {editing ? (
        <form onSubmit={handleSubmit} className="flex items-center justify-center min-w-0 max-w-full">
          {/*
           * min-w-0 + maxWidth: a long title used to widen the input past the header (which
           * clips), pushing the check button off screen on a phone.
           */}
          <input
            type="text"
            aria-label="Titre de la conversation"
            data-testid="chat-title-input"
            className="bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary rounded px-2 mr-2 min-w-0 flex-1"
            autoFocus
            value={currentDescription}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            style={{ width: `${Math.max(currentDescription.length * 8, 100)}px`, maxWidth: '100%' }}
          />
          <TooltipProvider>
            <WithTooltip tooltip="Enregistrer le titre">
              <div className="flex shrink-0 justify-between items-center p-2 rounded-md bg-bolt-elements-item-backgroundAccent">
                {/*
                 * Submit only through the form. onMouseDown={handleSubmit} made one click save
                 * twice; preventDefault on mousedown keeps the input focused so its blur
                 * (which cancels the edit) does not fire before the click submits.
                 */}
                <button
                  type="submit"
                  aria-label="Enregistrer le titre"
                  data-testid="chat-title-save"
                  className="i-ph:check-bold scale-110 hover:text-bolt-elements-item-contentAccent"
                  onMouseDown={(event) => event.preventDefault()}
                />
              </div>
            </WithTooltip>
          </TooltipProvider>
        </form>
      ) : (
        <>
          <span className="truncate">{currentDescription}</span>
          <TooltipProvider>
            <WithTooltip tooltip="Renommer la conversation">
              {/*
               * Was a bare `<button className="ml-2 i-ph:pencil-fill">`: no aria-label, no
               * type, and therefore the browser's default light-grey button surface painted
               * a stray rectangle through the dark header (measured: background
               * rgb(248,248,242)). Real semantics + an explicit transparent surface.
               */}
              <button
                type="button"
                aria-label="Renommer la conversation"
                data-testid="rename-chat"
                className="header-icon-control ml-1"
                onClick={(event) => {
                  event.preventDefault();
                  toggleEditMode();
                }}
              >
                <span className="i-ph:pencil-simple text-base" aria-hidden="true" />
              </button>
            </WithTooltip>
          </TooltipProvider>
        </>
      )}
    </div>
  );
}
