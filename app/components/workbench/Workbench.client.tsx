import { useStore } from '@nanostores/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { diffLines, type Change } from 'diff';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState, useMemo, useRef, lazy, Suspense } from 'react';
import type { JSX } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { EditorPanel } from './EditorPanel';
import type { ElementInfo } from './Inspector';
import { canSyncToFolder } from './folderSync';
import { DEFAULT_TERMINAL_SIZE, TerminalTabs } from './terminal/TerminalTabs';

import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import useViewport from '~/lib/hooks';
import { chatStore } from '~/lib/stores/chat';
import { usePreviewStore } from '~/lib/stores/previews';
import { streamingState } from '~/lib/stores/streaming';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { toast } from '~/lib/toastify';
import type { FileHistory } from '~/types/actions';
import { classNames } from '~/utils/classNames';
import { debounce } from '~/utils/debounce';

// Lazy load heavy components for better initial load performance
const DiffView = lazy(() => import('./DiffView').then((m) => ({ default: m.DiffView })));
const Preview = lazy(() => import('./Preview').then((m) => ({ default: m.Preview })));
import { cubicEasingFn } from '~/utils/easings';
import { getLanguageFromExtension } from '~/utils/getLanguageFromExtension';
import { renderLogger } from '~/utils/logger';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  metadata?: {
    gitUrl?: string;
  };
  updateChatMestaData?: (metadata: any) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: (element: ElementInfo | null) => void;
  exportChat?: () => void;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: { value: 'code', text: 'Code' },
  middle: { value: 'diff', text: 'Diff' },
  right: { value: 'preview', text: 'Aperçu' },
};

const workbenchVariants = {
  closed: { width: 0, transition: { duration: 0.2, ease: cubicEasingFn } },
  open: { width: 'var(--workbench-width)', transition: { duration: 0.2, ease: cubicEasingFn } },
} satisfies Variants;

const FileModifiedDropdown = memo(
  ({
    fileHistory,
    onSelectFile,
  }: {
    fileHistory: Record<string, FileHistory>;
    onSelectFile: (filePath: string) => void;
  }) => {
    const modifiedFiles = Object.entries(fileHistory);
    const hasChanges = modifiedFiles.length > 0;
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');

    // Debounce search to improve performance
    const debouncedSetQuery = useMemo(() => debounce((query: string) => setDebouncedQuery(query), 300), []);

    useEffect(() => {
      debouncedSetQuery(searchQuery);
    }, [searchQuery, debouncedSetQuery]);

    const filteredFiles = useMemo(() => {
      if (!debouncedQuery) {
        return modifiedFiles;
      }

      const query = debouncedQuery.toLowerCase();

      return modifiedFiles.filter(([filePath]) => filePath.toLowerCase().includes(query));
    }, [modifiedFiles, debouncedQuery]);

    return (
      <div className="flex items-center gap-2">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-1.5 min-h-11 text-sm rounded-lg bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3 transition-colors text-bolt-elements-item-contentDefault"
            >
              <span>Modifications de fichiers</span>
              {hasChanges && (
                <span className="w-5 h-5 rounded-full bg-accent-500/20 text-accent-700 text-xs flex items-center justify-center border border-accent-500/30">
                  {modifiedFiles.length}
                </span>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              className="z-50 w-80 rounded-xl bg-bolt-elements-background-depth-2 shadow-xl border border-bolt-elements-borderColor outline-none"
            >
              <div className="p-2">
                <div className="relative mx-2 mb-2">
                  <input
                    type="text"
                    placeholder="Rechercher des fichiers…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary">
                    <div className="i-ph:magnifying-glass" />
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto">
                  {filteredFiles.length > 0 ? (
                    filteredFiles.map(([filePath, history]) => {
                      const extension = filePath.split('.').pop() || '';
                      const language = getLanguageFromExtension(extension);

                      return (
                        <button
                          key={filePath}
                          onClick={() => onSelectFile(filePath)}
                          className="w-full px-3 py-2 min-h-11 text-left rounded-md hover:bg-bolt-elements-background-depth-1 transition-colors group bg-transparent"
                        >
                          <div className="flex items-center gap-2">
                            <div className="shrink-0 w-5 h-5 text-bolt-elements-textTertiary">
                              {['typescript', 'javascript', 'jsx', 'tsx'].includes(language) && (
                                <div className="i-ph:file-js" />
                              )}
                              {['css', 'scss', 'less'].includes(language) && <div className="i-ph:paint-brush" />}
                              {language === 'html' && <div className="i-ph:code" />}
                              {language === 'json' && <div className="i-ph:brackets-curly" />}
                              {language === 'python' && <div className="i-ph:file-text" />}
                              {language === 'markdown' && <div className="i-ph:article" />}
                              {['yaml', 'yml'].includes(language) && <div className="i-ph:file-text" />}
                              {language === 'sql' && <div className="i-ph:database" />}
                              {language === 'dockerfile' && <div className="i-ph:cube" />}
                              {language === 'shell' && <div className="i-ph:terminal" />}
                              {![
                                'typescript',
                                'javascript',
                                'css',
                                'html',
                                'json',
                                'python',
                                'markdown',
                                'yaml',
                                'yml',
                                'sql',
                                'dockerfile',
                                'shell',
                                'jsx',
                                'tsx',
                                'scss',
                                'less',
                              ].includes(language) && <div className="i-ph:file-text" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate text-sm font-medium text-bolt-elements-textPrimary">
                                    {filePath.split('/').pop()}
                                  </span>
                                  <span className="truncate text-xs text-bolt-elements-textTertiary">{filePath}</span>
                                </div>
                                {(() => {
                                  // Calculate diff stats
                                  const { additions, deletions } = (() => {
                                    if (!history.originalContent) {
                                      return { additions: 0, deletions: 0 };
                                    }

                                    const normalizedOriginal = history.originalContent.replace(/\r\n/g, '\n');

                                    const normalizedCurrent =
                                      history.versions[history.versions.length - 1]?.content.replace(/\r\n/g, '\n') ||
                                      '';

                                    if (normalizedOriginal === normalizedCurrent) {
                                      return { additions: 0, deletions: 0 };
                                    }

                                    const changes = diffLines(normalizedOriginal, normalizedCurrent, {
                                      newlineIsToken: false,
                                      ignoreWhitespace: true,
                                    });

                                    return changes.reduce(
                                      (acc: { additions: number; deletions: number }, change: Change) => {
                                        if (change.added) {
                                          acc.additions += change.value.split('\n').length;
                                        }

                                        if (change.removed) {
                                          acc.deletions += change.value.split('\n').length;
                                        }

                                        return acc;
                                      },
                                      { additions: 0, deletions: 0 },
                                    );
                                  })();

                                  const showStats = additions > 0 || deletions > 0;

                                  return (
                                    showStats && (
                                      <div className="flex items-center gap-1 text-xs shrink-0">
                                        {additions > 0 && (
                                          <span className="text-green-700 dark:text-green-400">+{additions}</span>
                                        )}
                                        {deletions > 0 && (
                                          <span className="text-red-700 dark:text-red-400">-{deletions}</span>
                                        )}
                                      </div>
                                    )
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center p-4 text-center">
                      <div className="w-12 h-12 mb-2 text-bolt-elements-textTertiary">
                        <div className="i-ph:file-dashed" />
                      </div>
                      <p className="text-sm font-medium text-bolt-elements-textPrimary">
                        {searchQuery ? 'Aucun fichier correspondant' : 'Aucun fichier modifié'}
                      </p>
                      <p className="text-xs text-bolt-elements-textSecondary mt-1">
                        {searchQuery
                          ? 'Essayez une autre recherche'
                          : 'Les modifications apparaîtront ici pendant l’édition'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {hasChanges && (
                <div className="border-t border-bolt-elements-borderColor p-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(filteredFiles.map(([filePath]) => filePath).join('\n'));
                      toast('Liste des fichiers copiée', {
                        icon: <div className="i-ph:check-circle text-accent-500" />,
                      });
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 min-h-11 text-sm rounded-lg bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-3 transition-colors text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                  >
                    Copier la liste des fichiers
                  </button>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    );
  },
);

export const Workbench = memo(
  ({
    chatStarted,
    isStreaming,
    metadata: _metadata,
    updateChatMestaData: _updateChatMestaData,
    selectedElement,
    setSelectedElement,
    exportChat,
  }: WorkspaceProps) => {
    renderLogger.trace('Workbench');

    const [fileHistory, setFileHistory] = useState<Record<string, FileHistory>>({});

    // const modifiedFiles = Array.from(useStore(workbenchStore.unsavedFiles).keys());

    const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const selectedFile = useStore(workbenchStore.selectedFile);
    const currentDocument = useStore(workbenchStore.currentDocument);
    const unsavedFiles = useStore(workbenchStore.unsavedFiles);
    const files = useStore(workbenchStore.files);
    const selectedView = useStore(workbenchStore.currentView);
    const showTerminal = useStore(workbenchStore.showTerminal);
    const userSelectedView = useStore(workbenchStore.userSelectedView);
    const { showChat } = useStore(chatStore);

    const isSmallViewport = useViewport(1024);
    const folderSyncSupported = useMemo(() => canSyncToFolder(), []);
    const streaming = useStore(streamingState);
    const [isSyncing, setIsSyncing] = useState(false);
    const [loadedViews, setLoadedViews] = useState<Set<WorkbenchViewType>>(() => new Set(['code']));
    const previousHasPreviewRef = useRef(hasPreview);

    const setSelectedView = (view: WorkbenchViewType) => {
      workbenchStore.selectWorkbenchView(view, { userInitiated: true });
    };

    /*
     * Auto-switch to Preview when it first becomes available AND the user hasn't
     * explicitly chosen a view.
     *
     * A reopened chat is the case that used to be missed: the restore happens
     * during the same commit that mounts this component, so `previousHasPreviewRef`
     * is ALREADY `true` on the first run and no transition is ever observed — the
     * user lands on the Code tab with the dev server running behind it.
     *
     * `hasPreview` alone is therefore not enough to mean "the user has seen it":
     * what matters is whether the workbench has already shown a preview for this
     * chat. Track that separately, and re-arm it whenever the chat changes.
     */
    const openChatId = useStore(workbenchStore.previewRestoreToken);
    const [showPreviewFor, setShowPreviewFor] = useState<number>(0);

    useEffect(() => {
      const previewBecameAvailable = hasPreview && !previousHasPreviewRef.current;
      previousHasPreviewRef.current = hasPreview;

      if (!hasPreview || userSelectedView) {
        return;
      }

      if (previewBecameAvailable || showPreviewFor !== openChatId) {
        workbenchStore.currentView.set('preview');
        setShowPreviewFor(openChatId);
      }
    }, [hasPreview, userSelectedView, openChatId, showPreviewFor]);

    /*
     * If the user explicitly chose a non-preview view but the system switched to preview,
     * restore the user's preference
     */
    useEffect(() => {
      if (!userSelectedView || userSelectedView === 'preview' || selectedView !== 'preview') {
        return;
      }

      workbenchStore.currentView.set(userSelectedView);
    }, [selectedView, userSelectedView]);

    // Track which views have been loaded for lazy rendering
    useEffect(() => {
      setLoadedViews((current) => {
        if (current.has(selectedView)) {
          return current;
        }

        const next = new Set(current);
        next.add(selectedView);

        return next;
      });
    }, [selectedView]);

    useEffect(() => {
      workbenchStore.setDocuments(files);
    }, [files]);

    const onEditorChange = useCallback<OnEditorChange>((update) => {
      workbenchStore.setCurrentDocumentContent(update.content);
    }, []);

    const onEditorScroll = useCallback<OnEditorScroll>((position) => {
      workbenchStore.setCurrentDocumentScrollPosition(position);
    }, []);

    const onFileSelect = useCallback((filePath: string | undefined) => {
      workbenchStore.setSelectedFile(filePath);
    }, []);

    const onFileSave = useCallback(() => {
      workbenchStore
        .saveCurrentDocument()
        .then(() => {
          // Explicitly refresh all previews after a file save
          const previewStore = usePreviewStore();
          previewStore.refreshAllPreviews();
        })
        .catch(() => {
          toast.error('Impossible de mettre à jour le contenu du fichier');
        });
    }, []);

    const onFileReset = useCallback(() => {
      workbenchStore.resetCurrentDocument();
    }, []);

    const handleSelectFile = useCallback((filePath: string) => {
      workbenchStore.setSelectedFile(filePath);
      workbenchStore.currentView.set('diff');
    }, []);

    const handleSyncFiles = useCallback(async () => {
      setIsSyncing(true);

      try {
        const directoryHandle = await window.showDirectoryPicker();
        await workbenchStore.syncFiles(directoryHandle);
        toast.success('Fichiers synchronisés');
      } catch (error) {
        console.error('Erreur de synchronisation des fichiers :', error);
        toast.error('Impossible de synchroniser les fichiers');
      } finally {
        setIsSyncing(false);
      }
    }, []);

    return (
      chatStarted && (
        <motion.div
          initial="closed"
          animate={showWorkbench ? 'open' : 'closed'}
          variants={workbenchVariants}
          className="z-workbench"
        >
          <div
            className={classNames(
              'fixed top-[calc(var(--header-height)+0.5rem)] lg:top-[calc(var(--header-height)+1.2rem)] bottom-0 lg:bottom-6 w-[var(--workbench-inner-width)] z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
              {
                'w-full': isSmallViewport,
                'left-0': showWorkbench && isSmallViewport,
                'left-[var(--workbench-left)]': showWorkbench,
                'left-[100%]': !showWorkbench,
              },
            )}
          >
            <div className="absolute inset-0 lg:px-4">
              <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border-t lg:border border-bolt-elements-borderColor shadow-sm lg:rounded-lg overflow-hidden">
                <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor gap-1.5">
                  {/*
                   * Kept at every width and at its original compact size: below 1024px it is the
                   * only way back to the conversation once the workbench fills the screen, so
                   * hiding it (or boxing it at 44px) removed a control the operator needs.
                   */}
                  <button
                    type="button"
                    aria-label={showChat ? 'Masquer la conversation' : 'Afficher la conversation'}
                    title={showChat ? 'Masquer la conversation' : 'Afficher la conversation'}
                    className={`${showChat ? 'i-ph:sidebar-simple-fill' : 'i-ph:sidebar-simple'} text-lg text-bolt-elements-textSecondary mr-1 p-1 rounded-md hover:bg-bolt-elements-item-backgroundActive focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500`}
                    onClick={() => {
                      chatStore.setKey('showChat', !showChat);
                    }}
                  />
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                  <div className="ml-auto" />
                  {selectedView === 'code' && (
                    <div className="flex overflow-y-auto">
                      {/* Export Chat Button */}
                      <ExportChatButton exportChat={exportChat} />

                      {/* Sync uniquement quand l’API File System Access est disponible. */}
                      {folderSyncSupported && (
                        <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden ml-1">
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger
                              disabled={isSyncing || streaming}
                              className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs !bg-accent-700 !text-white hover:!text-white hover:!bg-accent-700 outline-accent-500 flex gap-1.7 min-h-11"
                            >
                              {isSyncing ? 'Synchronisation…' : 'Synchroniser'}
                              <span className={classNames('i-ph:caret-down transition-transform')} />
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content
                              className={classNames(
                                'min-w-[240px] z-[250]',
                                'bg-bolt-elements-background-depth-1',
                                'rounded-lg shadow-lg',
                                'border border-bolt-elements-borderColor',
                                'animate-in fade-in-0 zoom-in-95',
                                'py-1',
                              )}
                              sideOffset={5}
                              align="end"
                            >
                              <DropdownMenu.Item
                                className={classNames(
                                  'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                                )}
                                onClick={handleSyncFiles}
                                disabled={isSyncing}
                              >
                                <div className="flex items-center gap-2">
                                  {isSyncing ? (
                                    <div className="i-ph:spinner" />
                                  ) : (
                                    <div className="i-ph:cloud-arrow-down" />
                                  )}
                                  <span>{isSyncing ? 'Synchronisation…' : 'Synchroniser les fichiers'}</span>
                                </div>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Root>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedView === 'diff' && (
                    <FileModifiedDropdown fileHistory={fileHistory} onSelectFile={handleSelectFile} />
                  )}
                  <IconButton
                    icon="i-ph:x-circle"
                    title="Fermer l’atelier"
                    className="-mr-1"
                    size="xl"
                    onClick={() => {
                      workbenchStore.showWorkbench.set(false);
                    }}
                  />
                </div>
                <Group orientation="vertical" className="flex-1 min-h-0">
                  <Panel defaultSize={showTerminal ? 100 - DEFAULT_TERMINAL_SIZE : '100%'} minSize={20}>
                    <div className="relative h-full overflow-hidden">
                      <View
                        data-testid="workbench-code-view"
                        aria-hidden={!showWorkbench || selectedView !== 'code'}
                        inert={!showWorkbench || selectedView !== 'code' ? true : undefined}
                        initial={{ x: '0%' }}
                        animate={{ x: selectedView === 'code' ? '0%' : '-100%' }}
                      >
                        <EditorPanel
                          editorDocument={currentDocument}
                          isStreaming={isStreaming}
                          selectedFile={selectedFile}
                          files={files}
                          unsavedFiles={unsavedFiles}
                          fileHistory={fileHistory}
                          onFileSelect={onFileSelect}
                          onEditorScroll={onEditorScroll}
                          onEditorChange={onEditorChange}
                          onFileSave={onFileSave}
                          onFileReset={onFileReset}
                        />
                      </View>
                      {loadedViews.has('diff') ? (
                        <View
                          aria-hidden={!showWorkbench || selectedView !== 'diff'}
                          inert={!showWorkbench || selectedView !== 'diff' ? true : undefined}
                          initial={{ x: '100%' }}
                          animate={{ x: selectedView === 'diff' ? '0%' : selectedView === 'code' ? '100%' : '-100%' }}
                        >
                          <Suspense
                            fallback={
                              <div className="flex items-center justify-center h-full">
                                <div className="i-ph:spinner animate-spin text-2xl text-bolt-elements-textTertiary" />
                              </div>
                            }
                          >
                            <DiffView fileHistory={fileHistory} setFileHistory={setFileHistory} />
                          </Suspense>
                        </View>
                      ) : null}
                      {loadedViews.has('preview') ? (
                        <View
                          aria-hidden={!showWorkbench || selectedView !== 'preview'}
                          inert={!showWorkbench || selectedView !== 'preview' ? true : undefined}
                          initial={{ x: '100%' }}
                          animate={{ x: selectedView === 'preview' ? '0%' : '100%' }}
                        >
                          <Suspense
                            fallback={
                              <div className="flex items-center justify-center h-full">
                                <div className="i-ph:spinner animate-spin text-2xl text-bolt-elements-textTertiary" />
                              </div>
                            }
                          >
                            <Preview selectedElement={selectedElement} setSelectedElement={setSelectedElement} />
                          </Suspense>
                        </View>
                      ) : null}
                    </div>
                  </Panel>
                  <Separator />
                  <TerminalTabs />
                </Group>
                {/*
                 * Lovable's mobile preview bar: one obvious way back to the chat.
                 * Le bouton X en haut à droite était la seule sortie et se repérait mal sur téléphone.
                 */}
                {isSmallViewport && (
                  <div
                    data-testid="workbench-mobile-bar"
                    className="flex items-center gap-2 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
                  >
                    <button
                      type="button"
                      data-testid="back-to-chat"
                      onClick={() => workbenchStore.showWorkbench.set(false)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-4 text-sm font-medium text-bolt-elements-textPrimary shadow-xs transition-colors hover:bg-bolt-elements-background-depth-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
                    >
                      <span className="i-ph:caret-left text-base" aria-hidden="true" />
                      Discussion
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )
    );
  },
);

// View component for rendering content with motion transitions
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
