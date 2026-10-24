import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Checkbox } from '~/components/ui/Checkbox';
import WithTooltip from '~/components/ui/Tooltip';
import { useEditChatDescription } from '~/lib/hooks';
import { db, prefetchChat, type ChatHistoryItem } from '~/lib/persistence';
import { detectDebugScope, type DebugScope } from '~/lib/persistence/debugChat';
import { closeSidebar } from '~/lib/stores/sidebar';
import { cleanChatTitle } from '~/utils/chatTitle';
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
  const [editingLocally, setEditingLocally] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const wasEditingRef = useRef(false);

  /*
   * A debug conversation is labelled from its own messages, not from a stored flag: the flag
   * would be missing on every chat created before it existed, and those are exactly the ones
   * polluting the list today. See `detectDebugScope` for the rule and why it is narrow.
   */
  const debugScope = detectDebugScope(item.messages ?? []);

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

  useEffect(() => {
    if (!editing && wasEditingRef.current) {
      setEditingLocally(false);
    }

    wasEditingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!editingLocally) {
      return;
    }

    const input = actionsRef.current
      ?.closest('[data-history-row]')
      ?.querySelector<HTMLInputElement>('input[data-history-edit]');
    input?.focus();
    input?.select();
  }, [editingLocally]);

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
      data-history-row={item.id}
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

      {editing || editingLocally ? (
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            data-history-edit={item.id}
            aria-label="Titre de la conversation"
            className="flex-1 min-w-0 bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary rounded-md px-3 py-1.5 text-sm border border-bolt-elements-borderColor focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive/50"
            autoFocus
            value={currentDescription}
            onChange={handleChange}
            onBlur={() => {
              void handleBlur();
              setEditingLocally(false);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            aria-label="Enregistrer le titre"
            className="i-ph:check h-4 w-4 shrink-0 text-gray-500 hover:text-purple-500 transition-colors"
            onMouseDown={(event) => event.preventDefault()}
          />
        </form>
      ) : (
        <>
          <Link
            to={`/chat/${item.urlId}`}
            className="flex flex-1 relative items-center gap-3 min-w-0"
            onClick={(event) => {
              if (selectionMode) {
                handleItemClick(event);
                return;
              }

              /*
               * Only a real, user-intended click closes the panel.
               *
               * The action buttons (Export, Duplicate, Rename) call preventDefault, and their
               * click still bubbles here: closing then hid the rename field the user had just
               * opened. Closing the sidebar is still needed because it is `position: fixed` at a
               * high z-index and overlays the chat column, covering the error banner's buttons.
               */
              if (event.defaultPrevented) {
                return;
              }

              closeSidebar();
            }}
          >
            {/* `cleanChatTitle`: stored titles may still start with « [Model: x] [Provider: y] ». */}
            <ProjectMonogram title={cleanChatTitle(currentDescription)} />
            <WithTooltip tooltip={cleanChatTitle(currentDescription)}>
              <span className="truncate" data-testid="history-item-title">
                {cleanChatTitle(currentDescription)}
              </span>
            </WithTooltip>
            {debugScope && <DebugBadge scope={debugScope} />}
          </Link>
          <div ref={actionsRef} className="flex shrink-0 items-center gap-0.5 text-gray-600 dark:text-gray-300">
            <ChatActionButton
              toolTipContent="Exporter"
              icon="i-ph:download-simple h-4 w-4"
              onClick={() => exportChat(item.id)}
            />
            {onDuplicate && (
              <ChatActionButton
                toolTipContent="Dupliquer"
                icon="i-ph:copy h-4 w-4"
                onClick={() => onDuplicate(item.id)}
              />
            )}
            <ChatActionButton
              toolTipContent="Renommer"
              icon="i-ph:pencil-fill h-4 w-4"
              onClick={(event) => {
                event.preventDefault();
                setEditingLocally(true);
                toggleEditMode();
              }}
            />
            <ChatActionButton
              toolTipContent="Supprimer"
              icon="i-ph:trash h-4 w-4"
              className="hover:text-red-600 dark:hover:text-red-400"
              onClick={handleDeleteClick}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ChatActionButton({
  toolTipContent,
  icon,
  className,
  onClick,
}: {
  toolTipContent: string;
  icon: string;
  className?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
}) {
  return (
    <WithTooltip tooltip={toolTipContent} position="bottom" sideOffset={4}>
      <button
        type="button"
        aria-label={toolTipContent}
        className={`flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-gray-600 dark:text-gray-300 hover:text-accent-700 dark:hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${className ?? ''}`}
        onClick={(event) => {
          event.stopPropagation();
          onClick(event);
        }}
      >
        <span className={icon} aria-hidden="true" />
      </button>
    </WithTooltip>
  );
}

/*
 * Lovable-style project tile: the first letter on a colour derived from the
 * title, so every project is recognisable at a glance without a screenshot.
 */
const MONOGRAM_COLORS = [
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
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

/**
 * The visible mark of a debug conversation.
 *
 * Amber, not red: a debug session is not an error, it is something that should not be mistaken
 * for the user's own work. The text is not decorative — a colour alone would be lost on a
 * colour-blind reader and on the truncated titles that make these entries unrecognisable in
 * the first place, so the chip spells "DEBUG" out.
 */
function DebugBadge({ scope }: { scope: DebugScope }) {
  const label = scope === 'probe' ? 'SONDE' : 'DEBUG';

  return (
    <span
      data-testid="debug-badge"
      title={
        scope === 'probe'
          ? 'Conversation de test (sonde) : aucun projet construit ici.'
          : 'Session de debug : conversation créée par un test automatisé.'
      }
      className="mr-1 shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"
    >
      {label}
    </span>
  );
}
