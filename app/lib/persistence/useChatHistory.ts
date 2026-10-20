import { generateId, type UIMessage } from 'ai';
import { atom } from 'nanostores';
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useLoaderData, useNavigate, useParams, useSearchParams, type NavigateFunction } from 'react-router';
import {
  createDeleteActions,
  createEncodedFileActions,
  lastAgentStartCommand,
  messagesContainStartAction,
  replayAgentFileOps,
  touchesDependencies,
} from './agentFileReplay';
import { getCachedMessages, getCachedSnapshot, invalidateChatCache } from './chatCache';
import {
  annotateTurn,
  buildAgentRestoreActions,
  missingTurnContext,
  replayFilesFromSnapshot,
  withChatNarration,
} from './chatRestore';
import {
  getMessagesByIdRaw,
  getMessagesByUrlIdRaw,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  createChatWithNextId,
  getUrlId,
  setSnapshot,
  type IChatMetadata,
} from './db';
import { pushChat, reconcileChat } from './historySync';
import { createMessage, getMessageAnnotations, getMessageText, hasMessageFlag, type AnyPart } from './messageMigration';
import { buildAgentReplayMessage } from './restoreArtifacts';
import { snapshotFileMapEntries } from './snapshotFiles';
import type { Snapshot } from './types';
import type { FileMap } from '~/lib/stores/files';
import { logStore } from '~/lib/stores/logs'; // Import logStore
import { workbenchStore } from '~/lib/stores/workbench';
import { toast } from '~/lib/toastify';
import { webcontainer } from '~/lib/webcontainer';
import { compatFileContent } from '~/lib/webcontainer/viteConfigCompat';
import type { ContextAnnotation } from '~/types/context';
import { detectProjectCommands, createCommandActionsString } from '~/utils/projectCommands';

/** How often a long Agent turn refreshes its in-progress snapshot. */
const STREAMING_SNAPSHOT_INTERVAL_MS = 20_000;

/*
 * How often a streaming turn mirrors the whole conversation to the server. Every 50 ms
 * sample used to send a full PUT; the end of the turn always pushes.
 */
const STREAMING_PUSH_INTERVAL_MS = 10_000;

/** Quiet time after a manual file edit before it is captured in the chat's snapshot. */
const USER_EDIT_SNAPSHOT_DEBOUNCE_MS = 1_500;

/** Longest description derived from the first prompt when no artifact names the chat. */
const FALLBACK_DESCRIPTION_LENGTH = 80;

/**
 * Commands appended to the replay message: deletions the agent made, a fresh install when
 * it rewrote the manifest, then the dev server again. A shell action interrupts the running
 * process, so anything emitted here must end with the start command.
 */
function replayCommandActions(options: {
  deleted: string[];
  reinstall: boolean;
  setupCommand?: string;
  startCommand?: string;
}): string {
  const deleteActions = createDeleteActions(options.deleted);
  const install = options.reinstall ? options.setupCommand || 'npm install' : '';

  if (!deleteActions && !install) {
    return '';
  }

  return [
    deleteActions,
    install ? `<boltAction type="shell">${install}</boltAction>` : '',
    options.startCommand ? `<boltAction type="start">${options.startCommand}</boltAction>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Removes `?rewindTo=` from the address bar without a router navigation (which would reload). */
function stripRewindParam() {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);

  if (!url.searchParams.has('rewindTo')) {
    return;
  }

  url.searchParams.delete('rewindTo');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** A readable name for a chat no artifact ever titled (Agent mode, discussion). */
function fallbackDescription(messages: UIMessage[]): string | undefined {
  const firstPrompt = messages.find((message) => message.role === 'user');
  const text = firstPrompt ? getMessageText(firstPrompt).replace(/\s+/g, ' ').trim() : '';

  if (!text) {
    return undefined;
  }

  return text.length > FALLBACK_DESCRIPTION_LENGTH ? `${text.slice(0, FALLBACK_DESCRIPTION_LENGTH - 1)}…` : text;
}

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: UIMessage[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

/** Text files of a snapshot, by absolute path. Binary entries are written by restoreSnapshot only. */
const snapshotTextFiles = replayFilesFromSnapshot;

/**
 * A never-stored assistant message that writes back the files Agent-mode tool calls
 * produced. Tool calls are not re-executed on restore, so without it a reopened agent
 * project shows the starter template (see agentFileReplay.ts).
 */
function createAgentReplayMessage(files: Record<string, string>, commandActions = ''): UIMessage | undefined {
  return buildAgentReplayMessage(files, commandActions, createEncodedFileActions, createMessage, generateId) as
    UIMessage | undefined;
}

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);

let filesystemTransitionQueue: Promise<void> = Promise.resolve();

function serializeFilesystemTransition<T>(operation: () => Promise<T>): Promise<T> {
  const transition = filesystemTransitionQueue.then(operation, operation);
  filesystemTransitionQueue = transition.then(
    () => undefined,
    () => undefined,
  );

  return transition;
}

export function useChatHistory({ loadHistory = true }: { loadHistory?: boolean } = {}) {
  const navigate = useNavigate();
  const { id: paramId } = useParams<{ id?: string }>();
  const loaderData = useLoaderData<{ id?: string }>() as { id?: string } | undefined;
  const mixedId = paramId ?? loaderData?.id;
  const [searchParams] = useSearchParams();

  const [archivedMessages, setArchivedMessages] = useState<UIMessage[]>([]);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlIdState] = useState<string | undefined>();

  /*
   * Read by the save queue, which runs in closures from older renders: an urlId allocated
   * by one save must be seen by the next one, or each save allocated a new suffix.
   */
  const urlIdRef = useRef<string | undefined>(undefined);

  const setUrlId = useCallback((value: string | undefined) => {
    urlIdRef.current = value;
    setUrlIdState(value);
  }, []);

  /*
   * Lost-update guard (another device continued this chat while it is open here): the
   * timestamp of the record this tab last loaded or wrote, and whether a conflict stopped
   * the saves.
   */
  const knownTimestampRef = useRef<string | undefined>(undefined);
  const conflictChatIdRef = useRef<string | undefined>(undefined);
  const lastCheckedCountRef = useRef(0);
  const lastPushAtRef = useRef(0);

  /* `${chatId}:${rewindId}` once that rewind's truncated history has been saved. */
  const consumedRewindRef = useRef<string | undefined>(undefined);
  const activeRewindRef = useRef<string | undefined>(undefined);

  /* What a manual-edit snapshot anchors on, and whether a turn is streaming. */
  const lastPersistedMessageIdRef = useRef<string | undefined>(undefined);
  const streamingRef = useRef(false);

  /*
   * Whether `initialMessages` belong to a different chat than the one that was
   * on screen. Consumers that keep their own per-chat state, such as the message
   * parser, need it to tell a switch apart from a re-read of the same chat.
   */
  const [chatChanged, setChatChanged] = useState(false);

  /*
   * The chat the messages, artifacts and files on screen belong to. Keyed on the
   * persisted record rather than on the route, because storeMessageHistory moves
   * a chat that is already on screen to /chat/<id> with history.replaceState,
   * which the router does pick up. That re-run is not a switch.
   */
  const loadedChatIdRef = useRef<string | undefined>(undefined);
  const loadGenerationRef = useRef(0);
  const routeHandoffChatIdRef = useRef<string | undefined>(undefined);
  const pendingChatCreationRef = useRef<Promise<{ id: string; urlId?: string }> | undefined>(undefined);
  const pendingChatNavigationRef = useRef<{ id: string; urlId?: string } | undefined>(undefined);
  const messageHistoryQueueRef = useRef<Promise<void>>(Promise.resolve());
  const messageHistoryGenerationRef = useRef(0);
  const persistenceRouteRef = useRef(mixedId);

  useLayoutEffect(() => {
    if (persistenceRouteRef.current !== mixedId) {
      persistenceRouteRef.current = mixedId;
      messageHistoryGenerationRef.current++;
    }
  }, [mixedId]);

  useEffect(() => {
    let cleanup: () => void = () => undefined;

    /*
     * Export/duplicate consumers do not own the chat or its filesystem.
     * Only Chat loads history and manages workbench transitions.
     */
    if (!loadHistory) {
      setReady(true);

      return cleanup;
    }

    const generation = ++loadGenerationRef.current;
    const isCurrentLoad = () => loadGenerationRef.current === generation;

    cleanup = () => {
      if (isCurrentLoad()) {
        loadGenerationRef.current++;
      }
    };

    if (!db) {
      setReady(true);

      if (persistenceEnabled) {
        const error = new Error('Chat persistence is unavailable');
        logStore.logError('Chat persistence initialization failed', error);
        toast.error('Chat persistence is unavailable');
      }

      return cleanup;
    }

    if (mixedId) {
      if (!routeHandoffChatIdRef.current) {
        setReady(false);
      }

      getCachedMessages(db, mixedId)
        .then(async (localMessages) => {
          /*
           * Not on this device yet (direct link, another device, sidebar never synced): ask
           * the server before giving up. Only IndexedDB was read, so such a link always
           * bounced to the home page.
           */
          const storedMessages =
            localMessages && localMessages.messages.length > 0
              ? localMessages
              : ((await reconcileChat(db, mixedId).catch(() => undefined)) ?? localMessages);

          const snapshot = storedMessages ? await getCachedSnapshot(db, storedMessages.id) : undefined;

          return [storedMessages, snapshot] as const;
        })
        .then(async ([storedMessages, snapshot]) => {
          if (!isCurrentLoad()) {
            return;
          }

          if (storedMessages && storedMessages.messages.length > 0) {
            if (routeHandoffChatIdRef.current === storedMessages.id && loadedChatIdRef.current === storedMessages.id) {
              /*
               * A new chat has just been persisted and its route is catching
               * up. Keep ChatImpl mounted and retain its completed live state.
               */
              routeHandoffChatIdRef.current = undefined;
              setChatChanged(false);
              setReady(true);

              return;
            }

            /*
             * Keyed on the persisted record, not on the route. The effect also
             * re-runs for a rewind or a `?prompt=` navigation within the same
             * chat, and those must not empty the project.
             */
            const switchedChat = loadedChatIdRef.current !== storedMessages.id;

            /*
             * Emptied before anything of the incoming chat is written, so the
             * messages, the artifacts and the container never describe different
             * chats.
             */
            if (switchedChat) {
              await serializeFilesystemTransition(async () => {
                if (isCurrentLoad()) {
                  await workbenchStore.resetWorkbench(isCurrentLoad);
                }
              });

              if (!isCurrentLoad()) {
                return;
              }
            }

            /*
             * const snapshotStr = localStorage.getItem(`snapshot:${mixedId}`); // Remove localStorage usage
             * const snapshot: Snapshot = snapshotStr ? JSON.parse(snapshotStr) : { chatIndex: 0, files: {} }; // Use snapshot from DB
             */
            const validSnapshot: Snapshot = snapshot || { chatIndex: '', files: {} }; // Ensure snapshot is not undefined
            const summary = validSnapshot.summary;

            /*
             * A chat is only "back" if it reads back. Reopened ones used to show a timeline of tool
             * rows and empty assistant bubbles, because the agent's narration lives in text parts
             * that the bubble never renders. The narration is folded into the rendered `content`,
             * so a turn shows what was said around its tool calls.
             *
             * The catalog replay below still reads `storedMessages`: same messages, and the reading
             * helpers fall back to the parts when `content` is empty.
             */
            const repairedMessages = withChatNarration(storedMessages.messages) as UIMessage[];

            const requestedRewind = searchParams.get('rewindTo');
            const rewindKey = `${storedMessages.id}:${requestedRewind}`;

            const rewindIndex = requestedRewind
              ? storedMessages.messages.findIndex((m) => m.id === requestedRewind)
              : -1;

            /*
             * An unknown target (a never-stored replay message, a stale link) used to give
             * endingIdx 0: an empty conversation that the next save wrote over the whole
             * history. A rewind already saved must not apply again either, or every reload
             * dropped the turns made after it.
             */
            const rewindId =
              requestedRewind && rewindIndex >= 0 && consumedRewindRef.current !== rewindKey
                ? requestedRewind
                : undefined;

            if (requestedRewind && !rewindId) {
              if (rewindIndex < 0) {
                toast.warning('Impossible de revenir à ce message : il ne fait pas partie de la conversation.');
              }

              stripRewindParam();
            }

            activeRewindRef.current = rewindId ? rewindKey : undefined;

            let startingIdx = -1;

            const endingIdx = rewindId ? rewindIndex + 1 : repairedMessages.length;

            const snapshotIndex = repairedMessages.findIndex((m) => m.id === validSnapshot.chatIndex);

            if (snapshotIndex >= 0 && snapshotIndex < endingIdx) {
              startingIdx = snapshotIndex;
            }

            // Index 0 is a valid anchor: the mid-turn snapshot of a chat's first turn sits there.
            if (snapshotIndex >= 0 && storedMessages.messages[snapshotIndex].id == rewindId) {
              startingIdx = -1;
            }

            let filteredMessages = repairedMessages.slice(startingIdx + 1, endingIdx);
            let archivedMessages: UIMessage[] = [];
            let setupMessage: UIMessage | undefined;

            if (startingIdx >= 0) {
              archivedMessages = repairedMessages.slice(0, startingIdx + 1);
            }

            if (startingIdx >= 0 && validSnapshot.preserveMessagesOnRestore) {
              archivedMessages = [];
              await restoreSnapshot(validSnapshot, isCurrentLoad);

              if (!isCurrentLoad()) {
                return;
              }

              /*
               * This branch restores the files but keeps the original messages, so
               * the artifact that carries the install/start actions is NOT part of
               * the rendered conversation. Nothing would start the dev server and
               * the preview stayed empty — the file restore alone looked complete.
               * Detect the project's commands and run them explicitly.
               */
              const restoredFiles = Object.entries(validSnapshot?.files || {})
                .map(([key, value]) => (value?.type === 'file' ? { content: value.content, path: key } : null))
                .filter((x): x is { content: string; path: string } => !!x);

              /*
               * Every message is re-parsed below, so the starter's artifacts run again
               * over the snapshot; agent tool writes do not. Replay them last.
               */
              const agentReplay = replayAgentFileOps(storedMessages.messages.slice(0, endingIdx));

              if (restoredFiles.length > 0) {
                const projectCommands = await detectProjectCommands(restoredFiles);

                if (!isCurrentLoad()) {
                  return;
                }

                const commandActions = [
                  createDeleteActions(agentReplay.deleted),
                  projectCommands.setupCommand || projectCommands.startCommand
                    ? createCommandActionsString(projectCommands)
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n');

                /*
                 * Appended as a synthetic setup message so the parser emits the
                 * actions; it is never stored ('no-store').
                 */
                setupMessage = createAgentReplayMessage(agentReplay.files, commandActions);

                if (projectCommands.startCommand) {
                  workbenchStore.showPreviewAfterRestore();
                }
              }

              filteredMessages = repairedMessages.slice(0, endingIdx);

              if (setupMessage) {
                filteredMessages = [...filteredMessages, setupMessage];
              }
            } else if (startingIdx >= 0) {
              const files = Object.entries(validSnapshot?.files || {})
                .map(([key, value]) => {
                  if (value?.type !== 'file') {
                    return null;
                  }

                  return {
                    content: value.content,
                    path: key,
                  };
                })
                .filter((x): x is { content: string; path: string } => !!x); // Type assertion

              const projectCommands = await detectProjectCommands(files);

              if (!isCurrentLoad()) {
                return;
              }

              // Call the modified function to get only the command actions string
              const commandActionsString = createCommandActionsString(projectCommands);

              const restoredAssistantText = `Bolt Restored your chat from a snapshot. You can revert this message to load the full chat history.
                  <boltArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
                  ${createEncodedFileActions(snapshotTextFiles(snapshot))}
                  ${commandActionsString}
                  </boltArtifact>
                  `;

              const restoredSummary = summary
                ? [
                    {
                      chatId: storedMessages.messages[snapshotIndex].id,
                      type: 'chatSummary',
                      summary,
                    } satisfies ContextAnnotation,
                  ]
                : [];

              /*
               * Both shapes written. `annotations` still carries the v4 sentinels
               * and the summary because the v4 readers have not moved yet;
               * metadata.flags and the data-chatSummary part are what v5 reads.
               */
              const restoredParts: AnyPart[] = [
                { type: 'text', text: restoredAssistantText },
                ...(summary
                  ? [
                      {
                        type: 'data-chatSummary',
                        data: {
                          chatId: storedMessages.messages[snapshotIndex].id,
                          summary,
                        },
                      },
                    ]
                  : []),
              ];

              filteredMessages = [
                createMessage({
                  id: generateId(),
                  role: 'user',
                  text: `Restore project from snapshot`,
                  flags: ['no-store', 'hidden'],
                }) as UIMessage,
                {
                  ...(createMessage({
                    id: storedMessages.messages[snapshotIndex].id,
                    role: 'assistant',
                    text: restoredAssistantText,

                    // Carries a stored message's id, so Rewind to it is meaningful.
                    flags: ['no-store', 'rewindable'],
                  }) as UIMessage),

                  /*
                   * v5 removed UIMessage.annotations, so the summary now travels
                   * as a data-chatSummary part (above) and the 'no-store' flag
                   * as metadata.flags (set by createMessage). The legacy
                   * `annotations` mirror is preserved so a downgrade still
                   * works, which is why this object literal is cast.
                   */
                  parts: restoredParts as unknown as UIMessage['parts'],
                  annotations: ['no-store', ...restoredSummary],
                } as unknown as UIMessage,

                ...filteredMessages,
              ];

              /*
               * Agent turns after the snapshot edited files through tool calls, which are
               * not re-executed: write their final content back after everything else.
               */
              const agentReplay = replayAgentFileOps(storedMessages.messages.slice(0, endingIdx), {
                base: snapshotTextFiles(validSnapshot),
                replayFrom: startingIdx + 1,
              });

              /*
               * The agent also starts the project with a `project_run_command` tool call, which
               * is not re-executed either: without replaying it the terminal came back to a bare
               * `~/project` prompt and the preview stayed empty, even though every file was back.
               * `projectCommands.startCommand` (from the snapshot's own commands) is used when
               * there is one; the agent's own last command covers the chats whose snapshot has
               * no start action at all.
               */
              const agentStartCommand = lastAgentStartCommand(storedMessages.messages.slice(0, endingIdx));

              const startCommand = projectCommands.startCommand || agentStartCommand;

              const replayCommands =
                replayCommandActions({
                  deleted: agentReplay.deleted,
                  reinstall: touchesDependencies(agentReplay.files),
                  setupCommand: projectCommands.setupCommand,
                  startCommand,
                }) || (startCommand ? `<boltAction type="start">${startCommand}</boltAction>` : '');

              const agentReplayMessage = createAgentReplayMessage(agentReplay.files, replayCommands);

              if (agentReplayMessage) {
                filteredMessages = [...filteredMessages, agentReplayMessage];
              }

              await restoreSnapshot(validSnapshot, isCurrentLoad);

              if (!isCurrentLoad()) {
                return;
              }

              /*
               * The user's expectation when reopening a project is to SEE it, not
               * to read its source: put the workbench on the Preview tab. Done
               * only when a start command exists, so a chat with no runnable
               * project is left on Code instead of showing an empty frame.
               */
              if (startCommand) {
                workbenchStore.showPreviewAfterRestore();
              }
            } else if (startingIdx < 0) {
              /*
               * No usable snapshot: always the case on a device that did not build the
               * project, because snapshots live in this browser's IndexedDB only. The
               * artifacts re-run, but the agent's tool writes and its `npm run dev` do not,
               * so the preview stayed on the starter template (or showed nothing at all).
               */
              const replayed = repairedMessages.slice(0, endingIdx) as typeof storedMessages.messages;
              const agentReplay = replayAgentFileOps(replayed);

              /*
               * This device has none of the project's files: the replay is all it will ever get,
               * and in Agent mode no artifact ever started the server, so a project came back
               * empty. The detected commands are the only source of a start command here.
               */
              if (agentReplay.hasAgentWrites || agentReplay.deleted.length > 0) {
                let commandActions = '';
                let startsProject = messagesContainStartAction(replayed);

                const reinstall = touchesDependencies(agentReplay.files);

                if (!startsProject || reinstall || agentReplay.deleted.length > 0) {
                  const projectCommands = await detectProjectCommands(
                    Object.entries(agentReplay.state).map(([path, content]) => ({ path, content })),
                  );

                  if (!isCurrentLoad()) {
                    return;
                  }

                  /*
                   * A project whose only "run" was an Agent tool call has no start action in its
                   * record, and a manifest the agent rewrote makes the template's install stale.
                   * Both are covered by the same builder: what is missing is written, and a setup is
                   * chained in front of the start instead of being a separate action that can be
                   * skipped.
                   */
                  const agentStart = lastAgentStartCommand(replayed);

                  commandActions = [
                    createDeleteActions(agentReplay.deleted),
                    buildAgentRestoreActions({
                      commands: projectCommands,
                      agentStartCommand: agentStart,
                      reinstall,
                      hasStart: startsProject && !reinstall,
                    }),
                  ]
                    .filter(Boolean)
                    .join('\n');
                  startsProject = startsProject || Boolean(projectCommands.startCommand) || Boolean(agentStart);
                }

                const agentReplayMessage = createAgentReplayMessage(agentReplay.files, commandActions);

                if (agentReplayMessage) {
                  filteredMessages = [...filteredMessages, agentReplayMessage];
                }

                if (startsProject) {
                  workbenchStore.showPreviewAfterRestore();
                }
              }

              /*
               * The turn that lost its context (summary, selected files, token usage) gets it back
               * from the previous turns of the same chat, so the recap and the next request are not
               * blinder than the conversation they belong to.
               */
              const lastIndex = filteredMessages.length - 1;
              const lastTurn = filteredMessages[lastIndex];
              const recovered = missingTurnContext(replayed, lastTurn?.id);

              if (lastTurn && Object.keys(recovered).length > 0) {
                filteredMessages = [
                  ...filteredMessages.slice(0, lastIndex),
                  annotateTurn(lastTurn, recovered) as UIMessage,
                ];
              }
            }

            if (!isCurrentLoad()) {
              return;
            }

            loadedChatIdRef.current = storedMessages.id;
            knownTimestampRef.current = storedMessages.timestamp;
            conflictChatIdRef.current = undefined;
            lastCheckedCountRef.current = 0;
            lastPersistedMessageIdRef.current = repairedMessages[endingIdx - 1]?.id;
            setArchivedMessages(archivedMessages);
            setChatChanged(switchedChat);
            setInitialMessages(filteredMessages);

            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else {
            navigate('/', { replace: true });
          }

          setReady(true);
        })
        .catch(async (error) => {
          if (!isCurrentLoad()) {
            return;
          }

          console.error(error);

          logStore.logError('Failed to load chat messages or snapshot', error);

          /*
           * WebContainer's failure modes are opaque and one of them is actively
           * misleading. Translate the known ones into something the user can act
           * on, and keep the raw text so a bug report still carries it.
           */
          const raw = error instanceof Error ? error.message : 'Unknown error';
          const lower = raw.toLowerCase();

          let hint = '';

          if (lower.includes('unable to create more instances')) {
            hint =
              ' Close every other Bolt tab or window and reload — the in-browser runtime only allows one instance per site.';
          } else if (lower.includes('crossorigin') || lower.includes('cross-origin')) {
            hint =
              ' This page is not cross-origin isolated (crossOriginIsolated=' +
              String(typeof window !== 'undefined' && window.crossOriginIsolated) +
              '): the isolation headers are missing or this browser does not support the policy sent.';
          } else if (lower.includes('network') || lower.includes('failed to fetch')) {
            hint = ' The runtime could not be downloaded — check the connection and reload.';
          }

          toast.error(`Failed to load chat: ${raw}${hint}`);

          try {
            await serializeFilesystemTransition(async () => {
              if (isCurrentLoad()) {
                await workbenchStore.resetWorkbench(isCurrentLoad);
              }
            });
          } catch (resetError) {
            logStore.logError('Failed to reset the workbench after a chat load error', resetError);
          }

          if (!isCurrentLoad()) {
            return;
          }

          loadedChatIdRef.current = undefined;
          routeHandoffChatIdRef.current = undefined;
          knownTimestampRef.current = undefined;
          lastPersistedMessageIdRef.current = undefined;
          setInitialMessages([]);
          setArchivedMessages([]);
          setChatChanged(true);
          setUrlId(undefined);
          description.set(undefined);
          chatId.set(undefined);
          chatMetadata.set(undefined);
          setReady(true);
        });
    } else {
      /*
       * Persistence claims a chat before its first response finishes, while
       * navigation remains deferred on `/`. A home query refresh is still
       * that live chat and must not cancel its generation or clear its files.
       */
      if (pendingChatNavigationRef.current?.id === loadedChatIdRef.current && loadedChatIdRef.current) {
        setChatChanged(false);
        setReady(true);

        return cleanup;
      }

      // Clean reset when switching to a fresh chat (e.g., /)
      const leftChat = loadedChatIdRef.current !== undefined;

      if (leftChat) {
        loadedChatIdRef.current = undefined;
      }

      setReady(false);

      void serializeFilesystemTransition(async () => {
        if (leftChat && isCurrentLoad()) {
          await workbenchStore.resetWorkbench(isCurrentLoad);
        }
      })
        .then(() => {
          if (isCurrentLoad()) {
            setReady(true);
          }
        })
        .catch((error) => {
          logStore.logError('Failed to empty the workbench', error);

          if (isCurrentLoad()) {
            setReady(true);
          }
        });

      knownTimestampRef.current = undefined;
      conflictChatIdRef.current = undefined;
      lastPersistedMessageIdRef.current = undefined;
      setChatChanged(leftChat);
      setArchivedMessages([]);
      setInitialMessages([]);
      setUrlId(undefined);
      description.set(undefined);
      chatId.set(undefined);
      chatMetadata.set(undefined);
    }

    return cleanup;
  }, [loadHistory, mixedId, db, navigate, searchParams, setUrlId]); // Added db, navigate, searchParams dependencies

  const takeSnapshot = useCallback(
    async (chatRecordId: string, chatIdx: string, files: FileMap, chatSummary?: string) => {
      if (!chatRecordId || !db) {
        return;
      }

      const snapshot: Snapshot = {
        chatIndex: chatIdx,
        files,
        summary: chatSummary,
      };

      // localStorage.setItem(`snapshot:${id}`, JSON.stringify(snapshot)); // Remove localStorage usage
      try {
        await setSnapshot(db, chatRecordId, snapshot);
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        toast.error('Failed to save chat snapshot.');
        throw error;
      }
    },
    [db],
  );

  /*
   * A snapshot during a long Agent turn, anchored on the user message that started it.
   *
   * Snapshots were only taken once a turn ended. Closing the tab mid-turn left the newest
   * snapshot one turn behind: the agent's tool writes come back through the message replay,
   * but files produced any other way (a scaffolding command, a build, a binary asset) were
   * gone. Anchoring on the user message keeps the restore correct: the in-progress assistant
   * message stays after the snapshot, so its actions and tool writes are replayed over these
   * files. Throttled, and never awaited on the execution queue (it is busy by definition).
   */
  const lastStreamingSnapshotRef = useRef(0);

  const takeStreamingSnapshot = useCallback(
    async (chatRecordId: string, messages: UIMessage[]) => {
      const turnStart = messages.length - 2;

      if (
        turnStart < 0 ||
        messages[turnStart].role !== 'user' ||
        messages[turnStart + 1].role !== 'assistant' ||
        Date.now() - lastStreamingSnapshotRef.current < STREAMING_SNAPSHOT_INTERVAL_MS
      ) {
        return;
      }

      lastStreamingSnapshotRef.current = Date.now();

      // Best effort: the end-of-turn snapshot is still the authoritative one.
      await takeSnapshot(chatRecordId, messages[turnStart].id, workbenchStore.files.get()).catch(() => undefined);
    },
    [takeSnapshot],
  );

  /*
   * Manual edits (Ctrl+S, file tree) reached the history only through the next chat turn:
   * reloading without sending a message lost them. Debounced, and skipped while a turn
   * streams (its end-of-turn snapshot captures them).
   */
  useEffect(() => {
    if (!loadHistory || !db) {
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = workbenchStore.fileEditRevision.listen(() => {
      const editedChatId = chatId.get();

      clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          const currentChatId = chatId.get();

          if (
            !db ||
            !currentChatId ||
            currentChatId !== editedChatId ||
            loadedChatIdRef.current !== currentChatId ||
            streamingRef.current ||
            conflictChatIdRef.current === currentChatId
          ) {
            return;
          }

          const previous = await getCachedSnapshot(db, currentChatId).catch(() => undefined);
          const anchor = previous?.chatIndex || lastPersistedMessageIdRef.current;

          if (!anchor || chatId.get() !== currentChatId) {
            return;
          }

          await takeSnapshot(currentChatId, anchor, workbenchStore.files.get(), previous?.summary).catch(
            () => undefined,
          );
          invalidateChatCache(currentChatId);
        })();
      }, USER_EDIT_SNAPSHOT_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [loadHistory, takeSnapshot]);

  const restoreSnapshot = useCallback(async (snapshot?: Snapshot, isCurrentLoad: () => boolean = () => true) => {
    await serializeFilesystemTransition(async () => {
      // const snapshotStr = localStorage.getItem(`snapshot:${id}`); // Remove localStorage usage
      const container = await webcontainer;

      if (!isCurrentLoad()) {
        return;
      }

      const validSnapshot = snapshot || { chatIndex: '', files: {} };

      if (!validSnapshot?.files) {
        return;
      }

      const entries = Object.entries(validSnapshot.files);

      const getContainerPath = (filePath: string) => {
        const workdirPrefix = `${container.workdir}/`;

        if (filePath.startsWith(workdirPrefix)) {
          return filePath.slice(workdirPrefix.length);
        }

        /*
         * WebContainer filesystem methods resolve paths relative to the project
         * workdir; a leading slash would instead target the container root.
         */
        return filePath.replace(/^\/+/, '');
      };

      for (const [filePath, value] of entries) {
        if (value?.type === 'folder') {
          await container.fs.mkdir(getContainerPath(filePath), { recursive: true });

          if (!isCurrentLoad()) {
            return;
          }
        }
      }

      for (const [filePath, value] of entries) {
        if (value?.type === 'file') {
          if (value.isBinary) {
            const binaryContent = Uint8Array.from(atob(value.content), (character) => character.charCodeAt(0));
            await container.fs.writeFile(getContainerPath(filePath), binaryContent);
          } else {
            await container.fs.writeFile(getContainerPath(filePath), compatFileContent(filePath, value.content), {
              encoding: 'utf8',
            });
          }

          if (!isCurrentLoad()) {
            return;
          }
        }
      }

      /*
       * Register what was just written. The map otherwise waited for the watcher, and in that
       * window an agent write to a restored file failed with "exists on disk but is not
       * tracked by the workbench".
       */
      for (const [filePath, dirent] of Object.entries(snapshotFileMapEntries(validSnapshot.files, container.workdir))) {
        if (!workbenchStore.files.get()[filePath]) {
          workbenchStore.files.setKey(filePath, dirent);
        }
      }
    });
  }, []);

  return {
    ready,
    initialMessages,
    chatChanged,
    updateChatMestaData: async (metadata: IChatMetadata) => {
      const id = chatId.get();

      if (!db || !id) {
        return;
      }

      try {
        await setMessages(db, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: (messages: UIMessage[], isStreaming = false) => {
      const messageHistoryGeneration = messageHistoryGenerationRef.current;

      /*
       * The chat this save was requested for. Captured synchronously, before the body is
       * queued behind any in-flight save, so it survives the user opening another chat in
       * the meantime.
       *
       * `chatId.get()` used to be read inside the queued body (and again after several
       * awaits). By then the atom can already point at the NEW chat, so the OLD chat's
       * messages were written under the NEW chat's id — erasing the conversation the user
       * just opened, on every device.
       */
      const targetChatId = chatId.get();

      const persistMessageHistory = async () => {
        if (!db || messages.length === 0 || messageHistoryGeneration !== messageHistoryGenerationRef.current) {
          return;
        }

        const { firstArtifact } = workbenchStore;
        messages = messages.filter((m) => !hasMessageFlag(m, 'no-store'));

        if (messages.length === 0) {
          return;
        }

        streamingRef.current = isStreaming;

        let _urlId = urlIdRef.current;

        // Ensure chatId.get() is used here as well
        const creatingNewChat = initialMessages.length === 0 && !targetChatId;

        if (conflictChatIdRef.current && conflictChatIdRef.current === targetChatId) {
          return;
        }

        if (!_urlId && firstArtifact?.id) {
          /*
           * An existing chat getting its urlId from its first artifact: another local chat
           * may already hold that id (unique index), and every later save then failed.
           * A new chat is deduplicated by createChatWithNextId itself.
           */
          _urlId = creatingNewChat ? firstArtifact.id : await getUrlId(db, firstArtifact.id);
        }

        let chatSummary: string | undefined = undefined;

        const lastMessage = messages[messages.length - 1];

        if (lastMessage.role === 'assistant') {
          const chatSummaryAnnotation = getMessageAnnotations(lastMessage).find(
            (annotation) => annotation.type === 'chatSummary',
          );

          if (chatSummaryAnnotation) {
            chatSummary = chatSummaryAnnotation.summary as string;
          }
        }

        if (!description.get() && firstArtifact?.title) {
          description.set(firstArtifact?.title);
        }

        /*
         * A turn that ended without any artifact (Agent mode, discussion) left the chat with
         * neither a description nor a urlId, and the sidebar lists neither kind: the chat was
         * reachable by its URL only, on every device.
         */
        if (!isStreaming && !description.get()) {
          description.set(fallbackDescription([...archivedMessages, ...messages]));
        }

        let createdChat: { id: string; urlId?: string } | undefined;
        let ownsChatCreation = false;

        if (creatingNewChat) {
          let creationPromise = pendingChatCreationRef.current;

          if (!creationPromise) {
            ownsChatCreation = true;
            creationPromise = createChatWithNextId(
              db,
              [...archivedMessages, ...messages],
              _urlId,
              description.get(),
              chatMetadata.get(),
              Boolean(_urlId) || !isStreaming,
            );
            pendingChatCreationRef.current = creationPromise;
          }

          try {
            createdChat = await creationPromise;
          } finally {
            if (ownsChatCreation && pendingChatCreationRef.current === creationPromise) {
              pendingChatCreationRef.current = undefined;
            }
          }

          if (messageHistoryGeneration !== messageHistoryGenerationRef.current) {
            return;
          }

          _urlId = createdChat.urlId;

          if (ownsChatCreation) {
            const nextId = createdChat.id;
            _urlId = createdChat.urlId;

            chatId.set(nextId);
            knownTimestampRef.current = new Date().toISOString();
            conflictChatIdRef.current = undefined;

            /*
             * Claimed before navigating: the messages on screen already belong to
             * this chat, so the re-run that the new route triggers must not be read
             * as a switch away from it.
             */
            loadedChatIdRef.current = nextId;
            setUrlId(_urlId);

            pendingChatNavigationRef.current = { id: nextId, urlId: _urlId };
          }
        }

        // Ensure the id captured at the top of the queued body is reused, not re-read from the live atom.
        const finalChatId = createdChat?.id ?? targetChatId;

        if (!finalChatId) {
          console.error('Cannot save messages, chat ID is not set.');
          toast.error('Failed to save chat messages: Chat ID missing.');

          return;
        }

        const persistedMessages = [...archivedMessages, ...messages];

        if (!_urlId && !isStreaming && !createdChat) {
          _urlId = await getUrlId(db, finalChatId);
        }

        /*
         * Lost-update guard. The chat may have been continued on another device and pulled
         * into IndexedDB while this tab kept the older messages on screen: writing them
         * would erase the other device's turns here and, through the push, everywhere.
         * Checked once per new message and at the end of a turn, not on every sample.
         */
        if (!createdChat && (!isStreaming || persistedMessages.length !== lastCheckedCountRef.current)) {
          lastCheckedCountRef.current = persistedMessages.length;

          const current = await getMessagesByIdRaw(db, finalChatId).catch(() => undefined);
          const known = Date.parse(knownTimestampRef.current ?? '');

          if (current && !isNaN(known) && Date.parse(current.timestamp) > known) {
            const ours = new Set(persistedMessages.map((message) => message.id));

            if ((current.messages || []).some((message) => !ours.has(message.id))) {
              conflictChatIdRef.current = finalChatId;
              invalidateChatCache(finalChatId);

              if (_urlId) {
                invalidateChatCache(_urlId);
              }

              toast.error(
                "Cette conversation a été poursuivie sur un autre appareil. Rechargez la page pour l'afficher : ce message n'a pas été enregistré, pour ne pas écraser l'autre version.",
              );

              return;
            }
          }
        }

        // One timestamp for the local record and the server copy: they must compare equal.
        const savedAt = new Date().toISOString();

        if (!createdChat || !ownsChatCreation) {
          /*
           * Re-check the generation immediately before the write: an `await` above (urlId
           * lookup, lost-update read) may have let the user switch chats. Writing now would
           * commit this turn under the wrong conversation.
           */
          if (messageHistoryGeneration !== messageHistoryGenerationRef.current) {
            return;
          }

          await setMessages(db, finalChatId, persistedMessages, _urlId, description.get(), savedAt, chatMetadata.get());
          knownTimestampRef.current = savedAt;

          if (_urlId !== urlIdRef.current && messageHistoryGeneration === messageHistoryGenerationRef.current) {
            setUrlId(_urlId);
          }
        }

        /*
         * A rewind is applied for good once its truncated history is saved: drop it from the
         * address bar, or every reload truncated the conversation again.
         */
        if (activeRewindRef.current?.startsWith(`${finalChatId}:`)) {
          consumedRewindRef.current = activeRewindRef.current;
          activeRewindRef.current = undefined;
          stripRewindParam();
        }

        /*
         * Mirror the conversation to the server. This is the single point where a chat is
         * committed, so it is the only place that needs the push. Without it the conversations
         * lived only in IndexedDB — i.e. in one browser — so the server table stayed empty and
         * opening the project anywhere else showed nothing.
         *
         * Not awaited: a failed push must not fail the save. IndexedDB already holds the data
         * and the next sync retries; the user must never lose a conversation because the
         * network hiccuped.
         */
        if (!isStreaming || Date.now() - lastPushAtRef.current >= STREAMING_PUSH_INTERVAL_MS) {
          lastPushAtRef.current = Date.now();
          void pushChat(
            {
              id: finalChatId,
              urlId: _urlId,
              description: description.get(),
              messages: persistedMessages,
              timestamp: savedAt,
              metadata: chatMetadata.get(),
            } as Parameters<typeof pushChat>[0],
            db,
          );
        }

        /*
         * The IndexedDB write may finish after a route change; invalidate its
         * cache as soon as it commits even when this job is now stale.
         */
        invalidateChatCache(finalChatId);

        if (_urlId) {
          invalidateChatCache(_urlId);
        }

        if (messageHistoryGeneration !== messageHistoryGenerationRef.current) {
          return;
        }

        if (!isStreaming) {
          lastPersistedMessageIdRef.current = messages[messages.length - 1].id;

          /*
           * Final file actions and assistant tool calls must finish before the
           * snapshot is captured, otherwise a newer chat record can point at an
           * older or empty filesystem snapshot after reload.
           */
          await workbenchStore.waitForExecutionQueue();

          if (messageHistoryGeneration !== messageHistoryGenerationRef.current) {
            return;
          }

          await takeSnapshot(finalChatId, messages[messages.length - 1].id, workbenchStore.files.get(), chatSummary);
          invalidateChatCache(finalChatId);

          if (_urlId) {
            invalidateChatCache(_urlId);
          }
        } else {
          await takeStreamingSnapshot(finalChatId, messages);
        }

        if (!isStreaming && pendingChatNavigationRef.current?.id === finalChatId) {
          const pendingNavigation = pendingChatNavigationRef.current;
          pendingChatNavigationRef.current = undefined;
          routeHandoffChatIdRef.current = pendingNavigation.id;
          navigateChat(pendingNavigation.urlId || pendingNavigation.id, navigate);
        }
      };

      const queuedPersistence = messageHistoryQueueRef.current.then(persistMessageHistory, persistMessageHistory);
      messageHistoryQueueRef.current = queuedPersistence.then(
        () => undefined,
        () => undefined,
      );

      return queuedPersistence;
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: UIMessage[], metadata?: IChatMetadata) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages, metadata);
        navigate(`/chat/${newId}`);
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId ?? mixedId ?? chatId.get()) => {
      if (!db || !id) {
        return;
      }

      /*
       * Raw read on purpose: this is a backup, so it must reproduce the stored
       * record exactly rather than a migrated view of it.
       */
      const chat = (await getMessagesByIdRaw(db, id)) || (await getMessagesByUrlIdRaw(db, id));

      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(nextId: string, navigate: NavigateFunction) {
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true });
}
