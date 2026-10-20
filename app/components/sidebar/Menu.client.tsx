import { useStore } from '@nanostores/react';
import { motion, type Variants } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AccountMenu } from './AccountMenu';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';
import { OPEN_SETTINGS_EVENT } from '~/components/mobile/MobileNav';

/*
 * Lazy-load the heavy ControlPanel (settings UI).  Most users don't open it on
 * every visit, so keeping it out of the critical-path bundle improves initial
 * load time.
 */
const LazyControlPanel = lazy(() =>
  import('~/components/@settings/core/ControlPanel').then((m) => ({ default: m.ControlPanel })),
);
import { Button } from '~/components/ui/Button';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { DocumentationPanel } from '~/components/ui/DocumentationPanel';
import { SettingsButton, HelpButton } from '~/components/ui/SettingsButton';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';
import {
  db,
  deleteById,
  getAll,
  getCachedMessages,
  invalidateChatCache,
  chatId,
  type ChatHistoryItem,
  useChatHistory,
} from '~/lib/persistence';
import { migrateLocalHistoryToServer, markDeleted } from '~/lib/persistence/historySync';
import { deleteHistory } from '~/lib/persistence/syncClient';
import { chatStore } from '~/lib/stores/chat';
import {
  closeSidebar,
  initSidebar,
  openSidebar,
  peekSidebar,
  readSavedSidebarOpen,
  sidebarOpenStore,
  unpeekSidebar,
} from '~/lib/stores/sidebar';
import { toast } from '~/lib/toastify';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('HistoryMenu');

/** A DELETE that answered 404: nothing left to delete on the server. */
function isNotFound(result: { ok: boolean; error?: string; status?: number }): boolean {
  return result.status === 404 || result.error === 'HTTP 404';
}

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',

    // -100vw hides both the 340px desktop panel and the full-width phone panel.
    left: '-100vw',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent =
  { type: 'delete'; item: ChatHistoryItem } | { type: 'bulkDelete'; items: ChatHistoryItem[] } | null;

function CurrentDateTime() {
  const [dateTime, setDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/50">
      <div className="h-4 w-4 i-ph:clock opacity-80" />
      <div className="flex gap-2">
        <span>{dateTime.toLocaleDateString()}</span>
        <span>{dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

/**
 * Which cached chats the sidebar LIST may show.
 *
 * A chat without a urlId or a description is not presentable yet (the title is derived
 * from the first message), so the list hides it.
 */
export function listableChats(items: ChatHistoryItem[]): ChatHistoryItem[] {
  return items.filter((item) => item.urlId && item.description);
}

/**
 * Which cached chats the MIGRATION must consider: all of them.
 *
 * This is deliberately NOT `listableChats`. A chat with no urlId is precisely the one that
 * exists only in this browser and therefore the one the server still needs; filtering
 * before migrating dropped exactly those records, so a local-only conversation was never
 * uploaded however often the list refreshed. Kept as a named function so the distinction
 * is visible and testable rather than implied by an inline filter.
 */
export function syncableChatIds(items: ChatHistoryItem[]): string[] {
  return items.map((item) => item.id);
}

export const Menu = () => {
  const { duplicateCurrentChat, exportChat } = useChatHistory({ loadHistory: false });
  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ChatHistoryItem[]>([]);

  /*
   * Sync state for the discreet indicator beside "Your Chats". Stays 'unknown' until the
   * first attempt resolves, so it never claims "synced" before anything was tried.
   */
  const [syncState, setSyncState] = useState<'unknown' | 'syncing' | 'synced' | 'offline'>('unknown');

  /*
   * Sidebar visibility lives in a shared store (not useState) so the toggle
   * icon in the header — a sibling component — can drive it. Touch devices
   * start collapsed: on a phone the 340px panel would cover the whole chat.
   */
  const open = useStore(sidebarOpenStore);
  const { started: chatStarted } = useStore(chatStore);

  // Explicit open/close (buttons): remembered. Hover peeks use peek/unpeekSidebar.
  /*
   * Closing the history panel no longer has an in-panel button: the header toggle owns it
   * (see Header.tsx). `closeSidebar` is kept because `setOpen` is still the single explicit
   * open/close helper used by the effects below.
   */
  const setOpen = useCallback((next: boolean) => (next ? openSidebar() : closeSidebar()), []);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDocumentationOpen, setIsDocumentationOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const { filteredItems: filteredList, handleSearchChange } = useSearchFilter({
    items: list,
    searchFields: ['description'],
  });

  const loadEntries = useCallback(() => {
    /*
     * Captured in a local: the narrowing from this guard does not survive into the
     * `.then()` callbacks below, so TypeScript would still see `IDBDatabase | undefined`.
     */
    const database = db;

    if (!database) {
      return;
    }

    /*
     * Local cache first so the list renders immediately, then reconcile with bolt-history:
     * a conversation started on another device exists only on the server. Failures are
     * silent by design — an unreachable server must not empty a list the user can see.
     */
    setSyncState('syncing');

    getAll(database)
      .then((all) => {
        /*
         * The list shows the presentable chats; the migration gets every cached id — see
         * `syncableChatIds` for why those two sets must not be the same.
         */
        setList(listableChats(all));

        // setList returns void, so keep the list in scope rather than chaining it through.
        return migrateLocalHistoryToServer(database, syncableChatIds(all)).then((result) => {
          setSyncState(result.offline ? 'offline' : 'synced');

          if (result.pulled > 0 || result.pushed > 0) {
            // Chats arrived from the server, or a local one got its urlId: re-read.
            void getAll(database).then((list) => setList(listableChats(list)));
          }

          if (result.offline) {
            logger.debug('history sync offline; showing the local cache only');
          }
        });
      })
      .catch((error) => {
        setSyncState('offline');
        toast.error(error.message);
      });
  }, []);

  const deleteChat = useCallback(
    async (id: string): Promise<void> => {
      if (!db) {
        throw new Error('Database not available');
      }

      /*
       * Delete on the server FIRST, then locally.
       *
       * Order matters. This function used to only wipe IndexedDB, and the very next
       * `loadEntries()` called `migrateLocalHistoryToServer`, which still saw the chat on
       * the server, counted it as "pulled" and wrote it straight back into the local
       * cache — the conversation reappeared a second after being deleted. The server is
       * the source of truth across devices, so it has to be purged for the deletion to
       * stick. Purging the server first also means a failure there aborts before the
       * local copy is gone, so the user never ends up with a half-deleted chat.
       */
      let urlId: string | undefined;

      try {
        const cached = await getCachedMessages(db, id);
        urlId = cached?.urlId;
      } catch (cacheError) {
        // A missing cache entry is not fatal: we still try the id itself below.
        logger.debug('could not read the chat before deleting it', cacheError);
      }

      /*
       * The local key and the server key are not always the same string, so clear both
       * candidates rather than assuming one. A 404 on a key that was never there is a
       * normal, harmless outcome.
       */
      const serverIds = [id, urlId].filter((value, index, all): value is string => {
        return Boolean(value) && all.indexOf(value) === index;
      });

      let serverConfirmed = false;

      for (const serverId of serverIds) {
        const serverResult = await deleteHistory(serverId);

        // 404: the server never had (or already dropped) this key — the outcome we want.
        if (serverResult.ok || isNotFound(serverResult)) {
          serverConfirmed = true;
          break;
        }

        logger.debug(`server delete failed for ${serverId}`, serverResult.error);
      }

      /*
       * Every candidate failed (network, 5xx, 409): keep the local copy and report it. Going
       * on deleted the chat here only, it stayed on the server and came back on the other
       * devices, all under a "deleted" success toast.
       */
      if (!serverConfirmed) {
        throw new Error('Le serveur n’a pas confirmé la suppression.');
      }

      /*
       * Record the deletion BEFORE the list refresh. `loadEntries` runs a sync that would
       * otherwise pull the chat back from a server response that raced this DELETE, or
       * re-push it from a cache read taken before the wipe below.
       */
      markDeleted(id, urlId);

      // Delete chat snapshot from localStorage
      try {
        const snapshotKey = `snapshot:${id}`;
        localStorage.removeItem(snapshotKey);
        console.log('Removed snapshot for chat:', id);
      } catch (snapshotError) {
        console.error(`Error deleting snapshot for chat ${id}:`, snapshotError);
      }

      // Delete the chat from the local database
      await deleteById(db, id);
      console.log('Successfully deleted chat:', id);

      // Drop the memoised copy: a stale cache entry would re-seed the chat on reopen.
      invalidateChatCache(id);

      if (urlId) {
        invalidateChatCache(urlId);
      }
    },
    [db],
  );

  const deleteItem = useCallback(
    (event: React.UIEvent, item: ChatHistoryItem) => {
      event.preventDefault();
      event.stopPropagation();

      // Log the delete operation to help debugging
      console.log('Attempting to delete chat:', { id: item.id, description: item.description });

      deleteChat(item.id)
        .then(() => {
          toast.success('Conversation supprimée', {
            position: 'bottom-right',
            autoClose: 3000,
          });

          // Always refresh the list
          loadEntries();

          if (chatId.get() === item.id) {
            // hard page navigation to clear the stores
            console.log('Navigating away from deleted chat');
            window.location.pathname = '/';
          }
        })
        .catch((error) => {
          console.error('Failed to delete chat:', error);
          toast.error('Échec de la suppression : la conversation est conservée. Réessayez plus tard.', {
            position: 'bottom-right',
            autoClose: 5000,
          });

          // Still try to reload entries in case data has changed
          loadEntries();
        });
    },
    [loadEntries, deleteChat],
  );

  const deleteSelectedItems = useCallback(
    async (itemsToDeleteIds: string[]) => {
      if (!db || itemsToDeleteIds.length === 0) {
        console.log('Bulk delete skipped: No DB or no items to delete.');
        return;
      }

      console.log(`Starting bulk delete for ${itemsToDeleteIds.length} chats`, itemsToDeleteIds);

      let deletedCount = 0;

      const errors: string[] = [];
      const currentChatId = chatId.get();

      let shouldNavigate = false;

      // Process deletions sequentially using the shared deleteChat logic
      for (const id of itemsToDeleteIds) {
        try {
          await deleteChat(id);
          deletedCount++;

          if (id === currentChatId) {
            shouldNavigate = true;
          }
        } catch (error) {
          console.error(`Error deleting chat ${id}:`, error);
          errors.push(id);
        }
      }

      // Show appropriate toast message
      if (errors.length === 0) {
        toast.success(
          `${deletedCount} conversation${deletedCount === 1 ? '' : 's'} supprimée${deletedCount === 1 ? '' : 's'}`,
        );
      } else {
        toast.warning(
          `${deletedCount} sur ${itemsToDeleteIds.length} supprimées. ${errors.length} en échec, conservées.`,
          {
            autoClose: 5000,
          },
        );
      }

      // Reload the list after all deletions
      await loadEntries();

      // Clear selection state
      setSelectedItems([]);
      setSelectionMode(false);

      // Navigate if needed
      if (shouldNavigate) {
        console.log('Navigating away from deleted chat');
        window.location.pathname = '/';
      }
    },
    [deleteChat, loadEntries, db],
  );

  const closeDialog = () => {
    setDialogContent(null);
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);

    if (selectionMode) {
      // If turning selection mode OFF, clear selection
      setSelectedItems([]);
    }
  };

  const toggleItemSelection = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const newSelectedItems = prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id];
      console.log('Selected items updated:', newSelectedItems);

      return newSelectedItems; // Return the new array
    });
  }, []); // No dependencies needed

  const handleBulkDeleteClick = useCallback(() => {
    if (selectedItems.length === 0) {
      toast.info('Sélectionnez au moins une conversation');
      return;
    }

    const selectedChats = list.filter((item) => selectedItems.includes(item.id));

    if (selectedChats.length === 0) {
      toast.error('Could not find selected chats');
      return;
    }

    setDialogContent({ type: 'bulkDelete', items: selectedChats });
  }, [selectedItems, list]); // Keep list dependency

  const selectAll = useCallback(() => {
    const allFilteredIds = filteredList.map((item) => item.id);
    setSelectedItems((prev) => {
      const allFilteredAreSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => prev.includes(id));

      if (allFilteredAreSelected) {
        // Deselect only the filtered items
        const newSelectedItems = prev.filter((id) => !allFilteredIds.includes(id));
        console.log('Deselecting all filtered items. New selection:', newSelectedItems);

        return newSelectedItems;
      } else {
        // Select all filtered items, adding them to any existing selections
        const newSelectedItems = [...new Set([...prev, ...allFilteredIds])];
        console.log('Selecting all filtered items. New selection:', newSelectedItems);

        return newSelectedItems;
      }
    });
  }, [filteredList]); // Depends only on filteredList

  useEffect(() => {
    /*
     * Load once on mount, not only when the panel opens.
     *
     * Waiting for `open` made the list appear empty on a fresh browser: the panel starts
     * collapsed, so `loadEntries` never ran, and the conversations already stored on the server
     * were never pulled in. Loading on mount also means the sync has started by the time the
     * user opens the list, so it renders populated instead of flashing "No previous
     * conversations".
     */
    loadEntries();
  }, [loadEntries]);

  /*
   * `loadEntries` returns early while `db` is still undefined — the database opens
   * asynchronously — so the mount-time call above usually does nothing, and nothing ever
   * retried it: the sync simply never ran, so local conversations never reached the server
   * and server conversations never appeared. Re-run when the database becomes available.
   */
  useEffect(() => {
    if (db) {
      loadEntries();
    }
  }, [db, loadEntries]);

  /*
   * On touch devices the 340px panel would cover the entire chat, so start
   * collapsed. Runs once after mount because matchMedia is unavailable during
   * SSR; pointer-only devices keep the expanded default.
   */
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      initSidebar(window.matchMedia('(hover: none), (pointer: coarse)').matches);
    }
  }, []);

  // Exit selection mode when sidebar is closed
  useEffect(() => {
    if (!open && selectionMode) {
      /*
       * Don't clear selection state anymore when sidebar closes
       * This allows the selection to persist when reopening the sidebar
       */
      console.log('Sidebar closed, preserving selection state');
    }
  }, [open, selectionMode]);

  useEffect(() => {
    const enterThreshold = 20;
    const exitThreshold = 20;

    /*
     * Touch devices MUST NOT get this hover behaviour. Firefox for Android
     * synthesises mouse events after every tap (mousemove/mouseover) and
     * reports pageX/clientX as 0, so a tap would open the sidebar and a phantom
     * mousemove would immediately toggle it again. Chrome synthesises
     * differently, which is why this only misbehaved on Firefox.
     */
    const hasHover =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
        : false;

    if (!hasHover) {
      return undefined;
    }

    function onMouseMove(event: MouseEvent) {
      if (isSettingsOpen) {
        return;
      }

      if (event.pageX < enterThreshold && !sidebarOpenStore.get()) {
        peekSidebar();
      }

      // A sidebar the user pinned open (header toggle) stays open; a hover peek closes.
      if (
        sidebarOpenStore.get() &&
        readSavedSidebarOpen() !== true &&
        menuRef.current &&
        event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold
      ) {
        unpeekSidebar();
      }
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [isSettingsOpen, setOpen]);

  useEffect(() => {
    const handleOpenGitHubSettings = () => {
      setSettingsInitialTab('github');
      setIsSettingsOpen(true);
      unpeekSidebar();
    };

    // Mobile bottom navigation's Settings tab.
    const handleOpenSettings = (event: Event) => {
      setSettingsInitialTab((event as CustomEvent<{ tab?: string }>).detail?.tab);
      setIsSettingsOpen(true);
      unpeekSidebar();
    };

    document.addEventListener('open-github-settings', handleOpenGitHubSettings);
    window.addEventListener(OPEN_SETTINGS_EVENT, handleOpenSettings);

    return () => {
      document.removeEventListener('open-github-settings', handleOpenGitHubSettings);
      window.removeEventListener(OPEN_SETTINGS_EVENT, handleOpenSettings);
    };
  }, []);

  const handleDuplicate = async (id: string) => {
    await duplicateCurrentChat(id);
    loadEntries(); // Reload the list after duplication
  };

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
    unpeekSidebar();
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
    setSettingsInitialTab(undefined);

    /*
     * Tell the /settings route the panel is gone. That route only exists to keep a URL working;
     * once the panel closes it must hand the address back to `/`, or the address bar keeps
     * claiming a settings page that is no longer on screen.
     */
    window.dispatchEvent(new CustomEvent('bolt:settings-closed'));
  };

  const setDialogContentWithLogging = useCallback((content: DialogContent) => {
    console.log('Setting dialog content:', content);
    setDialogContent(content);
  }, []);

  return (
    <>
      {/* Full screen on phones (Lovable's Projects tab), a 340px panel from 768px. */}
      <motion.div
        ref={menuRef}
        id="sidebar-panel"
        initial="closed"
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        className={classNames(
          'flex selection-accent flex-col side-menu fixed top-0 h-full w-screen md:w-[340px] md:rounded-r-2xl',
          'bg-bolt-elements-background-depth-1 border-r border-bolt-elements-borderColor',
          'shadow-sm text-sm',
          isSettingsOpen ? 'z-40' : 'z-sidebar',
        )}
      >
        {/*
         * Panel header. It holds only the help and account controls: the close button that used
         * to sit on the left painted the same left chevron as the header's back control while
         * meaning the opposite action. Closing is the header toggle's job (it stays above this
         * panel, see `z-above-sidebar`), so there is exactly one close handle and no look-alike.
         */}
        <div className="h-12 flex items-center justify-end px-3 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 md:rounded-tr-2xl">
          <div className="flex items-center gap-1">
            <HelpButton onClick={() => setIsDocumentationOpen(true)} />
            <AccountMenu />
          </div>
        </div>
        <CurrentDateTime />
        <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <a
                href="/"
                className="flex-1 flex gap-2 items-center bg-accent-500/10 text-accent-600 hover:bg-accent-500/20 dark:bg-accent-500/15 dark:text-accent-400 rounded-lg px-4 py-2 transition-colors"
              >
                <span className="inline-block i-ph:plus-circle h-4 w-4" />
                <span className="text-sm font-medium">Nouvelle conversation</span>
              </a>
              <button
                type="button"
                onClick={toggleSelectionMode}
                className={classNames(
                  'flex gap-1 items-center rounded-lg px-3 py-2 transition-colors',
                  selectionMode
                    ? 'bg-accent-500 text-white'
                    : 'bg-transparent border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary',
                )}
                aria-label={selectionMode ? 'Quitter la sélection' : 'Sélectionner des conversations'}
              >
                <span className={selectionMode ? 'i-ph:x h-4 w-4' : 'i-ph:check-square h-4 w-4'} />
              </button>
            </div>
            <div className="relative w-full">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <span className="i-ph:magnifying-glass h-4 w-4 text-gray-400 dark:text-gray-500" />
              </div>
              <input
                className="w-full bg-bolt-elements-background-depth-2 relative pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive/50 text-sm text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary border border-bolt-elements-borderColor"
                type="search"
                placeholder="Rechercher une conversation…"
                onChange={handleSearchChange}
                aria-label="Rechercher une conversation"
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-sm px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="font-medium text-gray-600 dark:text-gray-400">Vos conversations</div>
              {/*
               * Discreet sync state. Only speaks up when something is wrong: a permanent
               * "synced" badge would be noise on every visit.
               */}
              {syncState === 'offline' && (
                <span
                  data-testid="history-sync-offline"
                  title="Historique local uniquement — le serveur est injoignable"
                  className="flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
                >
                  <span className="i-ph:cloud-slash text-xs" aria-hidden="true" />
                  Hors ligne
                </span>
              )}
              {syncState === 'syncing' && (
                <span
                  data-testid="history-sync-syncing"
                  title="Synchronisation en cours"
                  className="i-ph:cloud-arrow-up animate-pulse text-sm text-bolt-elements-textTertiary"
                  aria-hidden="true"
                />
              )}
            </div>
            {selectionMode && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  {selectedItems.length === filteredList.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDeleteClick}
                  disabled={selectedItems.length === 0}
                >
                  Supprimer la sélection
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto modern-scrollbar px-3 pb-3">
            {filteredList.length === 0 && (
              <div className="px-4 text-gray-500 dark:text-gray-400 text-sm">
                {list.length === 0 ? 'Aucune conversation' : 'Aucun résultat'}
              </div>
            )}
            {/* onOpenChange: Radix closes on Escape (and Android back) only through it. */}
            <DialogRoot
              open={dialogContent !== null}
              onOpenChange={(isOpen) => {
                if (!isOpen) {
                  closeDialog();
                }
              }}
            >
              {binDates(filteredList).map(({ category, items }) => (
                <div key={category} className="mt-2 first:mt-0 space-y-1">
                  <div className="text-xs font-medium text-bolt-elements-textTertiary sticky top-0 z-1 bg-bolt-elements-background-depth-1 px-4 py-1">
                    {category}
                  </div>
                  <div className="space-y-0.5 pr-1">
                    {items.map((item) => (
                      <HistoryItem
                        key={item.id}
                        item={item}
                        exportChat={exportChat}
                        onDelete={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          console.log('Delete triggered for item:', item);
                          setDialogContentWithLogging({ type: 'delete', item });
                        }}
                        onDuplicate={() => handleDuplicate(item.id)}
                        selectionMode={selectionMode}
                        isSelected={selectedItems.includes(item.id)}
                        onToggleSelection={toggleItemSelection}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
                {dialogContent?.type === 'delete' && (
                  <>
                    <div className="p-6 bg-bolt-elements-background-depth-1">
                      <DialogTitle className="text-bolt-elements-textPrimary">Supprimer la conversation ?</DialogTitle>
                      <DialogDescription className="mt-2 text-bolt-elements-textSecondary">
                        <p>
                          Vous allez supprimer{' '}
                          <span className="font-medium text-bolt-elements-textPrimary">
                            {dialogContent.item.description}
                          </span>
                        </p>
                        <p className="mt-2">Cette action est définitive sur tous vos appareils.</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-bolt-elements-background-depth-2 border-t border-bolt-elements-borderColor">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Annuler
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={(event) => {
                          console.log('Dialog delete button clicked for item:', dialogContent.item);
                          deleteItem(event, dialogContent.item);
                          closeDialog();
                        }}
                      >
                        Supprimer
                      </DialogButton>
                    </div>
                  </>
                )}
                {dialogContent?.type === 'bulkDelete' && (
                  <>
                    <div className="p-6 bg-bolt-elements-background-depth-1">
                      <DialogTitle className="text-bolt-elements-textPrimary">
                        Supprimer les conversations sélectionnées ?
                      </DialogTitle>
                      <DialogDescription className="mt-2 text-bolt-elements-textSecondary">
                        <p>
                          Vous allez supprimer {dialogContent.items.length}{' '}
                          {dialogContent.items.length === 1 ? 'conversation' : 'conversations'} :
                        </p>
                        <div className="mt-2 max-h-32 overflow-auto border border-bolt-elements-borderColor rounded-md bg-bolt-elements-background-depth-2 p-2">
                          <ul className="list-disc pl-5 space-y-1">
                            {dialogContent.items.map((item) => (
                              <li key={item.id} className="text-sm">
                                <span className="font-medium text-bolt-elements-textPrimary">{item.description}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <p className="mt-3">Cette action est définitive sur tous vos appareils.</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-bolt-elements-background-depth-2 border-t border-bolt-elements-borderColor">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Annuler
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={() => {
                          /*
                           * Delete exactly what the dialog listed, not the live selection.
                           *
                           * The selection can shrink while the dialog is open (a chat is deleted
                           * elsewhere, or a sync removes it), which would make the confirm button
                           * delete fewer — or, as here, the user deselects an item after opening
                           * the dialog and the count on screen no longer matches what gets
                           * deleted. Deriving the ids from `dialogContent.items` makes the action
                           * match the confirmation the user read.
                           */
                          const itemsToDeleteNow = dialogContent.items.map((item) => item.id);
                          console.log('Bulk delete confirmed for', itemsToDeleteNow.length, 'items', itemsToDeleteNow);
                          deleteSelectedItems(itemsToDeleteNow);
                          closeDialog();
                        }}
                      >
                        Supprimer
                      </DialogButton>
                    </div>
                  </>
                )}
              </Dialog>
            </DialogRoot>
          </div>
          {/*
           * Phones: on the landing page the bottom navigation has Settings and floats over
           * this row. In a conversation that navigation is not rendered, so this button is
           * the only way to Settings and must show (and the row needs no reserved space).
           */}
          <div
            className={classNames(
              'flex items-center justify-between border-t border-gray-200 dark:border-gray-800 px-4 py-3',
              chatStarted ? 'pb-3' : 'pb-[5.5rem] md:pb-3',
            )}
          >
            <div className={classNames('items-center gap-3', chatStarted ? 'flex' : 'hidden md:flex')}>
              <SettingsButton onClick={handleSettingsClick} />
            </div>
            <ThemeSwitch />
          </div>
        </div>
      </motion.div>

      {/*
       * There is deliberately no floating "open" chevron pinned to the left edge here.
       * It duplicated the header toggle (the only thing it added was a second, unlabelled
       * surface glued to the viewport edge, hard-coded at top-[72px], and it only existed on
       * desktop), while the hover-at-edge peek below already offers the same shortcut to a
       * mouse user. One open handle in the header, one close handle (the same toggle), plus
       * the hover peek: nothing to reconcile.
       */}

      <Suspense fallback={null}>
        <LazyControlPanel open={isSettingsOpen} onClose={handleSettingsClose} initialTab={settingsInitialTab as any} />
      </Suspense>
      <DocumentationPanel open={isDocumentationOpen} onClose={() => setIsDocumentationOpen(false)} />
    </>
  );
};
