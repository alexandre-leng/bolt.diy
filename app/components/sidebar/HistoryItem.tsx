import { forwardRef, type ForwardedRef, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { Checkbox } from '~/components/ui/Checkbox';
import WithTooltip from '~/components/ui/Tooltip';
import { useEditChatDescription } from '~/lib/hooks';
import { db, prefetchChat, type ChatHistoryItem } from '~/lib/persistence';
import { closeSidebar } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';

interface HistoryItemProps {
  item: ChatHistoryItem;
  onDelete?: (event: React.UIEvent) => void;
  onDuplicate?: (id: string) => void;
  exportChat: (id?: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
}

export function HistoryItem({
  item,
  onDelete,
  onDuplicate,
  exportChat,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: HistoryItemProps) {
  const { id: urlId } = useParams();
  const isActiveChat = urlId === item.urlId;

  const { editing, handleChange, handleBlur, handleSubmit, handleKeyDown, currentDescription, toggleEditMode } =
    useEditChatDescription({
      initialDescription: item.description,
      customChatId: item.id,
      syncWithGlobalStore: isActiveChat,
    });

  const handleItemClick = useCallback(
    (e: React.MouseEvent) => {
      if (selectionMode) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Item clicked in selection mode:', item.id);
        onToggleSelection?.(item.id);
      }
    },
    [selectionMode, item.id, onToggleSelection],
  );

  const handleCheckboxChange = useCallback(() => {
    console.log('Checkbox changed for item:', item.id);
    onToggleSelection?.(item.id);
  }, [item.id, onToggleSelection]);

  const handleDeleteClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Delete button clicked for item:', item.id);

      if (onDelete) {
        onDelete(event as unknown as React.UIEvent);
      }
    },
    [onDelete, item.id],
  );

  return (
    <div
      className={classNames(
        'group rounded-xl text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive overflow-hidden flex justify-between items-center px-2 py-1.5 transition-colors',
        { 'text-bolt-elements-textPrimary bg-bolt-elements-item-backgroundActive': isActiveChat },
        { 'cursor-pointer': selectionMode },
      )}
      onClick={selectionMode ? handleItemClick : undefined}
      onMouseEnter={() => prefetchChat(db, item.urlId || item.id)}
    >
      {selectionMode && (
        <div className="flex items-center mr-2" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            id={`select-${item.id}`}
            checked={isSelected}
            onCheckedChange={handleCheckboxChange}
            className="h-4 w-4"
          />
        </div>
      )}

      {editing ? (
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            aria-label="Titre de la conversation"
            className="flex-1 min-w-0 bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary rounded-md px-3 py-1.5 text-sm border border-bolt-elements-borderColor focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive/50"
            autoFocus
            value={currentDescription}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
          {/* Submit via the form only; mousedown keeps focus so the input's blur does not cancel. */}
          <button
            type="submit"
            aria-label="Enregistrer le titre"
            className="i-ph:check h-4 w-4 shrink-0 text-gray-500 hover:text-purple-500 transition-colors"
            onMouseDown={(event) => event.preventDefault()}
          />
        </form>
      ) : (
        <Link
          to={`/chat/${item.urlId}`}
          className="flex w-full relative items-center gap-3 min-w-0"
          onClick={(event) => {
            if (selectionMode) {
              handleItemClick(event);

              return;
            }

            /*
             * The action buttons (Export, Duplicate, Rename) live inside this link and call
             * preventDefault. Their click still bubbles here, and closing the panel then hid
             * the rename field the user had just opened. Only a real open closes it.
             */
            if (event.defaultPrevented) {
              return;
            }

            /*
             * Close the panel when a chat is opened.
             *
             * The sidebar is `position: fixed` at z-index 997 and overlays the
             * chat column. Left open, it covers the error banner's Dismiss and
             * Copy buttons, so they cannot be clicked — which reads to the user
             * as "the error never closes and can't be copied".
             */
            closeSidebar();
          }}
        >
          <ProjectMonogram title={currentDescription} />
          <WithTooltip tooltip={currentDescription}>
            <span className="truncate pr-24">{currentDescription}</span>
          </WithTooltip>
          <div
            className={classNames(
              'absolute right-0 top-0 bottom-0 flex items-center bg-transparent px-2 transition-colors',
            )}
          >
            {/* bolt-touch-visible: always shown on touch screens, where hover never happens. */}
            <div className="bolt-touch-visible flex items-center gap-2.5 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <ChatActionButton
                toolTipContent="Exporter"
                icon="i-ph:download-simple h-4 w-4"
                onClick={(event) => {
                  event.preventDefault();
                  exportChat(item.id);
                }}
              />
              {onDuplicate && (
                <ChatActionButton
                  toolTipContent="Dupliquer"
                  icon="i-ph:copy h-4 w-4"
                  onClick={(event) => {
                    event.preventDefault();
                    onDuplicate?.(item.id);
                  }}
                />
              )}
              <ChatActionButton
                toolTipContent="Renommer"
                icon="i-ph:pencil-fill h-4 w-4"
                onClick={(event) => {
                  event.preventDefault();
                  toggleEditMode();
                }}
              />
              <ChatActionButton
                toolTipContent="Supprimer"
                icon="i-ph:trash h-4 w-4"
                className="hover:text-red-500 dark:hover:text-red-400"
                onClick={handleDeleteClick}
              />
            </div>
          </div>
        </Link>
      )}
    </div>
  );
}

const ChatActionButton = forwardRef(
  (
    {
      toolTipContent,
      icon,
      className,
      onClick,
    }: {
      toolTipContent: string;
      icon: string;
      className?: string;
      onClick: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
      btnTitle?: string;
    },
    ref: ForwardedRef<HTMLButtonElement>,
  ) => {
    return (
      <WithTooltip tooltip={toolTipContent} position="bottom" sideOffset={4}>
        {/* aria-label: the tooltip alone left screen readers with an unnamed "button". */}
        <button
          ref={ref}
          type="button"
          aria-label={toolTipContent}
          className={`text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${icon} ${className ? className : ''}`}
          onClick={(event) => {
            // Keep the click away from the enclosing link (it navigates and closes the panel).
            event.stopPropagation();
            onClick(event);
          }}
        />
      </WithTooltip>
    );
  },
);

/*
 * Lovable-style project tile: the first letter on a colour derived from the
 * title, so every project is recognisable at a glance without a screenshot.
 */
const MONOGRAM_COLORS = [
  'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  'bg-pink-500/15 text-pink-600 dark:text-pink-300',
  'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
];

export function monogramFor(title: string) {
  const letter = (title.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();

  let hash = 0;

  for (const char of title) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return { letter, color: MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length] };
}

function ProjectMonogram({ title }: { title: string }) {
  const { letter, color } = monogramFor(title);

  return (
    <span
      aria-hidden="true"
      className={classNames(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
        color,
      )}
    >
      {letter}
    </span>
  );
}
