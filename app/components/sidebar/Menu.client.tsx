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
import { db, deleteById, getAll, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { migrateLocalHistoryToServer } from '~/lib/persistence/historySync';
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

  // Explicit open/close (buttons): remembered. Hover peeks use peek/unpeekSidebar.
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
      .then((list) => list.filter((item) => item.urlId && item.description))
      .then((localList) => {
        setList(localList);

        // setList returns void, so keep the list in scope rather than chaining it through.
        return migrateLocalHistoryToServer(
          database,
          localList.map((item) => item.id),
        ).then((result) => {
          setSyncState(result.offline ? 'offline' : 'synced');

          if (result.pulled > 0) {
            // New chats arrived from the server: re-read the cache to show them.
            void getAll(database)
              .then((list) => list.filter((item) => item.urlId && item.description))
              .then(setList);
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

      // Delete chat snapshot from localStorage
      try {
        const snapshotKey = `snapshot:${id}`;
        localStorage.removeItem(snapshotKey);
        console.log('Removed snapshot for chat:', id);
      } catch (snapshotError) {
        console.error(`Error deleting snapshot for chat ${id}:`, snapshotError);
      }

      // Delete the chat from the database
      await deleteById(db, id);
      console.log('Successfully deleted chat:', id);
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
          toast.success('Chat deleted successfully', {
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
          toast.error('Failed to delete conversation', {
            position: 'bottom-right',
            autoClose: 3000,
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
        toast.success(`${deletedCount} chat${deletedCount === 1 ? '' : 's'} deleted successfully`);
      } else {
        toast.warning(`Deleted ${deletedCount} of ${itemsToDeleteIds.length} chats. ${errors.length} failed.`, {
          autoClose: 5000,
        });
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
      toast.info('Select at least one chat to delete');
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
    if (open) {
      loadEntries();
    }
  }, [open, loadEntries]);

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
        <div className="h-12 flex items-center justify-between px-4 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 md:rounded-tr-2xl">
          {/*
           * In-panel close control. Without it the sidebar could only be closed
           * by a mouse leaving it (hover) — impossible on touch, where the
           * panel would then trap the user with the chat hidden behind it.
           */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            data-testid="sidebar-close"
            className={classNames(
              'flex items-center justify-center rounded-md p-1.5 -ml-1.5 transition-colors',
              'text-bolt-elements-textSecondary',
              'hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
              'active:bg-bolt-elements-background-depth-3',
            )}
          >
            <div className="i-ph:caret-left text-lg" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-3">
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
                className="flex-1 flex gap-2 items-center bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/20 rounded-lg px-4 py-2 transition-colors"
              >
                <span className="inline-block i-ph:plus-circle h-4 w-4" />
                <span className="text-sm font-medium">Start new chat</span>
              </a>
              <button
                onClick={toggleSelectionMode}
                className={classNames(
                  'flex gap-1 items-center rounded-lg px-3 py-2 transition-colors',
                  selectionMode
                    ? 'bg-purple-600 dark:bg-purple-500 text-white border border-purple-700 dark:border-purple-600'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700',
                )}
                aria-label={selectionMode ? 'Exit selection mode' : 'Enter selection mode'}
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
                placeholder="Search chats..."
                onChange={handleSearchChange}
                aria-label="Search chats"
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-sm px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="font-medium text-gray-600 dark:text-gray-400">Your Chats</div>
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
                  {selectedItems.length === filteredList.length ? 'Deselect all' : 'Select all'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDeleteClick}
                  disabled={selectedItems.length === 0}
                >
                  Delete selected
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto modern-scrollbar px-3 pb-3">
            {filteredList.length === 0 && (
              <div className="px-4 text-gray-500 dark:text-gray-400 text-sm">
                {list.length === 0 ? 'No previous conversations' : 'No matches found'}
              </div>
            )}
            <DialogRoot open={dialogContent !== null}>
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
                      <DialogTitle className="text-bolt-elements-textPrimary">Delete Chat?</DialogTitle>
                      <DialogDescription className="mt-2 text-bolt-elements-textSecondary">
                        <p>
                          You are about to delete{' '}
                          <span className="font-medium text-bolt-elements-textPrimary">
                            {dialogContent.item.description}
                          </span>
                        </p>
                        <p className="mt-2">Are you sure you want to delete this chat?</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-bolt-elements-background-depth-2 border-t border-bolt-elements-borderColor">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Cancel
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={(event) => {
                          console.log('Dialog delete button clicked for item:', dialogContent.item);
                          deleteItem(event, dialogContent.item);
                          closeDialog();
                        }}
                      >
                        Delete
                      </DialogButton>
                    </div>
                  </>
                )}
                {dialogContent?.type === 'bulkDelete' && (
                  <>
                    <div className="p-6 bg-bolt-elements-background-depth-1">
                      <DialogTitle className="text-bolt-elements-textPrimary">Delete Selected Chats?</DialogTitle>
                      <DialogDescription className="mt-2 text-bolt-elements-textSecondary">
                        <p>
                          You are about to delete {dialogContent.items.length}{' '}
                          {dialogContent.items.length === 1 ? 'chat' : 'chats'}:
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
                        <p className="mt-3">Are you sure you want to delete these chats?</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-bolt-elements-background-depth-2 border-t border-bolt-elements-borderColor">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Cancel
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={() => {
                          /*
                           * Pass the current selectedItems to the delete function.
                           * This captures the state at the moment the user confirms.
                           */
                          const itemsToDeleteNow = [...selectedItems];
                          console.log('Bulk delete confirmed for', itemsToDeleteNow.length, 'items', itemsToDeleteNow);
                          deleteSelectedItems(itemsToDeleteNow);
                          closeDialog();
                        }}
                      >
                        Delete
                      </DialogButton>
                    </div>
                  </>
                )}
              </Dialog>
            </DialogRoot>
          </div>
          {/* Phones: the bottom navigation already has Settings, and floats over this row. */}
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-800 px-4 py-3 pb-[5.5rem] md:pb-3">
            <div className="hidden md:flex items-center gap-3">
              <SettingsButton onClick={handleSettingsClick} />
            </div>
            <ThemeSwitch />
          </div>
        </div>
      </motion.div>

      {/* Persistent sidebar trigger when closed — desktop only; phones use the bottom navigation. */}
      {!open && !isSettingsOpen && (
        <button
          onClick={() => setOpen(true)}
          className={classNames(
            'hidden md:block fixed left-0 top-[72px] z-sidebar',
            'bg-bolt-elements-background-depth-1',
            'border border-l-0 border-bolt-elements-borderColor',
            'rounded-r-lg p-1.5 shadow-sm',
            'hover:bg-bolt-elements-background-depth-2',
            'transition-colors',
          )}
          aria-label="Open sidebar"
        >
          <div className="i-ph:caret-right text-gray-500 dark:text-gray-400" />
        </button>
      )}

      <Suspense fallback={null}>
        <LazyControlPanel open={isSettingsOpen} onClose={handleSettingsClose} initialTab={settingsInitialTab as any} />
      </Suspense>
      <DocumentationPanel open={isDocumentationOpen} onClose={() => setIsDocumentationOpen(false)} />
    </>
  );
};
