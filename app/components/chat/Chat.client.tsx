import { useChat } from '@ai-sdk/react';
import { useStore } from '@nanostores/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { useAnimate } from 'framer-motion';
import Cookies from 'js-cookie';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BaseChat } from './BaseChat';
import type { ElementInfo } from '~/components/workbench/Inspector';
import {
  appendSteer,
  applyRedirect,
  createTurnControl,
  drainRedirect,
  hasInterruptibleContent,
  queueRedirect,
  requestStop,
  shouldAcceptStop,
} from '~/lib/agent/turn-control';
import { API_KEYS_UPDATED_EVENT, type ApiKeysUpdatedDetail } from '~/lib/api/apiKeys';
import { isNetworkStreamError, reportChatFailure, trackedChatFetch } from '~/lib/chatStreamDiagnostics';
import { isServerAgentTool } from '~/lib/common/agentLoop';
import { STARTER_BUILD_FLAG } from '~/lib/common/starterBuild';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { useSettings } from '~/lib/hooks/useSettings';
import { description, useChatHistory } from '~/lib/persistence';
import { dropFailedTurn } from '~/lib/persistence/failedTurn';
import {
  createMessage,
  getMessageParts,
  getMessageText,
  getToolCallId,
  getToolInput,
  getToolName,
  isToolCallPart,
  type AnyPart,
} from '~/lib/persistence/messageMigration';
import { messagesChangedSinceLoad } from '~/lib/persistence/persistGate';
import { chatId } from '~/lib/persistence/useChatHistory';
import { executeTextUtility, getPluginToolName, isSupportedAdapter } from '~/lib/plugins/adapters';
import { pluginDatabase } from '~/lib/plugins/database';
import type { PluginManifest } from '~/lib/plugins/schema';
import { pluginManifestSchema } from '~/lib/plugins/schema';
import { callProjectMcpTool, PROJECT_TOOL_NAMES } from '~/lib/runtime/projectMcp';
import { chatStore } from '~/lib/stores/chat';
import { logStore } from '~/lib/stores/logs';
import { useMCPStore } from '~/lib/stores/mcp';
import { usePluginStore } from '~/lib/stores/plugins';
import { streamingState } from '~/lib/stores/streaming';
import { supabaseConnection } from '~/lib/stores/supabase';
import { workbenchStore } from '~/lib/stores/workbench';
import { toast } from '~/lib/toastify';
import type { LlmErrorAlertType } from '~/types/actions';
import type { ProgressAnnotation } from '~/types/context';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ProviderInfo } from '~/types/model';
import { shouldPreserveChatMessagesOnRefresh } from '~/utils/chatHistoryRefresh';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  PROMPT_COOKIE_KEY,
  PROVIDER_LIST,
  TOOL_EXECUTION_APPROVAL,
} from '~/utils/constants';
import { debounce } from '~/utils/debounce';
import { cubicEasingFn } from '~/utils/easings';
import { filesToArtifacts } from '~/utils/fileUtils';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { resolveProjectCallContext } from '~/utils/projectCallContext';
import { createCommandsMessage, detectProjectCommands } from '~/utils/projectCommands';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, chatChanged, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          chatChanged={chatChanged}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: UIMessage[];
    initialMessages: UIMessage[];
    isLoading: boolean;
    isPreparingProject: boolean;
    parseMessages: (messages: UIMessage[], isLoading: boolean) => void;
    storeMessageHistory: (messages: UIMessage[], isStreaming?: boolean) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, isPreparingProject, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messagesChangedSinceLoad(messages, initialMessages)) {
      storeMessageHistory(messages, isLoading || isPreparingProject).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: UIMessage[];

  /** True when `initialMessages` belong to a different chat than the ones they replace. */
  chatChanged: boolean;

  storeMessageHistory: (messages: UIMessage[], isStreaming?: boolean) => Promise<void>;
  importChat: (description: string, messages: UIMessage[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, chatChanged, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const hasAppliedInitialMessagesRef = useRef(false);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);

    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );

    // const _supabaseAlert = undefined;
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });

    const savedProviderCookie = Cookies.get('selectedProvider');

    const [provider, setProvider] = useState(() => {
      return (PROVIDER_LIST.find((p) => p.name === savedProviderCookie) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [agentMode, setAgentMode] = useState(() => Cookies.get('agentMode') === 'true');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);
    const installedPlugins = usePluginStore((state) => state.plugins);
    const initializePlugins = usePluginStore((state) => state.initialize);

    useEffect(() => {
      void initializePlugins();
    }, [initializePlugins]);

    /*
     * The default provider is the INSTANCE's, not this browser's.
     *
     * The cookie is a per-browser memory and can outlive an administrator's decision, so a
     * provider the instance no longer serves must not stay selected: every message would be
     * refused and the composer would look broken. Only a browser with NO saved choice is moved
     * to the instance default; one that picked a provider still served keeps it.
     */
    useEffect(() => {
      if (savedProviderCookie || activeProviders.length === 0) {
        return;
      }

      const preferred = activeProviders.find((candidate) => candidate.name === DEFAULT_PROVIDER.name);

      if (preferred && preferred.name !== provider.name) {
        setProvider(preferred);
      }
    }, [savedProviderCookie, activeProviders, provider.name]);

    /*
     * And a saved choice the instance does not serve falls back to one it does, rather than
     * failing on the next message.
     */
    useEffect(() => {
      if (activeProviders.length === 0 || activeProviders.some((candidate) => candidate.name === provider.name)) {
        return;
      }

      const fallback =
        activeProviders.find((candidate) => candidate.name === DEFAULT_PROVIDER.name) ?? activeProviders[0];

      setProvider(fallback);
      Cookies.set('selectedProvider', fallback.name, { expires: 30 });
      logStore.logProvider(`Provider ${provider.name} is not served by this instance, switched to ${fallback.name}`, {
        provider: fallback.name,
      });
    }, [activeProviders, provider.name]);

    /*
     * v5 removed the managed input state: `input`, `setInput` and
     * `handleInputChange` are gone, so it is local state here. `initialInput` is
     * gone too, hence the useState initializer.
     */
    const [input, setInput] = useState(Cookies.get(PROMPT_COOKIE_KEY) || '');

    /*
     * v5 removed the data array from useChat in favour of an onData
     * callback, so progress annotations are local state again.
     */
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const pendingTemplateContinuationRef = useRef<UIMessage | null>(null);

    /*
     * Control of the RUNNING turn (stop / steer / redirect), ported from Hermes Agent.
     * `generationRef` is the `require_generation` guard: a stop aimed at turn N must not cancel
     * turn N+1 that already started.
     */
    const turnControlRef = useRef(createTurnControl());
    const generationRef = useRef(0);
    const parsedStarterSetupMessagesRef = useRef(new Set<string>());

    const pendingTemplateParserRef = useRef<(messages: { id: string; role?: string }[], isLoading: boolean) => void>(
      () => undefined,
    );

    const bodyRef = useRef({
      apiKeys,
      files,
      promptId,
      contextOptimization: contextOptimizationEnabled,
      chatMode,
      agentMode,
      designScheme,
      supabase: {
        isConnected: mcpSettings.connectorEnabled.supabase && supabaseConn.isConnected,
        hasSelectedProject: mcpSettings.connectorEnabled.supabase && !!selectedProject,
        credentials: {
          supabaseUrl: mcpSettings.connectorEnabled.supabase ? supabaseConn?.credentials?.supabaseUrl : undefined,
          anonKey: mcpSettings.connectorEnabled.supabase ? supabaseConn?.credentials?.anonKey : undefined,
        },
      },
      maxLLMSteps: mcpSettings.maxLLMSteps,
      webSearchEnabled: mcpSettings.webSearchEnabled,
      connectorEnabled: mcpSettings.connectorEnabled,
      toolEnabled: mcpSettings.toolEnabled,
      plugins: installedPlugins
        .filter((plugin) => plugin.enabled)
        .map((plugin) => {
          const manifest = plugin.manifest as PluginManifest;
          const tools = manifest.tools.filter((tool) => plugin.configuration[`toolDisabled:${tool}`] !== true);

          return { id: plugin.id, adapter: manifest.contribution.adapter, tools };
        })
        .filter((plugin) => plugin.tools.length > 0),
    });

    bodyRef.current = {
      apiKeys,
      files,
      promptId,
      contextOptimization: contextOptimizationEnabled,
      chatMode,
      agentMode,
      designScheme,
      supabase: {
        isConnected: mcpSettings.connectorEnabled.supabase && supabaseConn.isConnected,
        hasSelectedProject: mcpSettings.connectorEnabled.supabase && !!selectedProject,
        credentials: {
          supabaseUrl: mcpSettings.connectorEnabled.supabase ? supabaseConn?.credentials?.supabaseUrl : undefined,
          anonKey: mcpSettings.connectorEnabled.supabase ? supabaseConn?.credentials?.anonKey : undefined,
        },
      },
      maxLLMSteps: mcpSettings.maxLLMSteps,
      webSearchEnabled: mcpSettings.webSearchEnabled,
      connectorEnabled: mcpSettings.connectorEnabled,
      toolEnabled: mcpSettings.toolEnabled,
      plugins: installedPlugins
        .filter((plugin) => plugin.enabled)
        .map((plugin) => {
          const manifest = plugin.manifest as PluginManifest;
          const tools = manifest.tools.filter((tool) => plugin.configuration[`toolDisabled:${tool}`] !== true);

          return { id: plugin.id, adapter: manifest.contribution.adapter, tools };
        })
        .filter((plugin) => plugin.tools.length > 0),
    };

    const {
      messages,
      status,
      stop,
      sendMessage: sendChatMessage,
      setMessages,
      error,
      addToolOutput,
    } = useChat({
      transport: new DefaultChatTransport({
        api: '/api/chat',

        // Records timings/bytes so a mid-stream network failure can be diagnosed.
        fetch: trackedChatFetch,

        /*
         * body is resolved per request, but only if it is a function. Passing a
         * plain object froze every value here at first render, which silently
         * staled the API keys, chat mode and step limit. Without this the
         * server received no chatMode at all and answered with discussPrompt()
         * instead of the build prompt, so no artifacts were ever produced.
         */
        body: () => bodyRef.current,
      }),

      /*
       * v5 removed useChat's `data` array. data-progress parts now arrive here
       * instead, and ProgressCompilation renders whatever this holds.
       */
      onData: (part) => {
        const data = part.data as Partial<ProgressAnnotation> | undefined;

        if (data?.type === 'progress' && typeof data.label === 'string') {
          setProgressAnnotations((previous) => [
            ...previous.filter((annotation) => annotation.label !== data.label),
            data as ProgressAnnotation,
          ]);
        }
      },

      /*
       * v5's addToolOutput only re-POSTs when sendAutomaticallyWhen says so.
       * Without this, approving an MCP tool updated the UI locally and never
       * reached the server, stalling the conversation.
       */
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
      },
      onFinish: ({ message }) => {
        setProgressAnnotations([]);

        const userMessages = messagesRef.current.filter((item) => item.role === 'user');

        /*
         * Blank starts have no manifest to inspect until the first code response
         * has landed. Add the detected setup actions in code when the model did
         * not include its own install/start actions.
         */
        const hasNativeProjectTools = [...messagesRef.current, message].some((candidate) =>
          (getMessageParts(candidate) ?? []).some((part) => {
            const name = getToolName(part);
            return name !== undefined && PROJECT_TOOL_NAMES.includes(name as (typeof PROJECT_TOOL_NAMES)[number]);
          }),
        );

        if (
          userMessages.length === 1 &&
          !agentMode &&
          !hasNativeProjectTools &&
          !/<boltAction\s+type=["'](?:shell|start)["']/.test(getMessageText(message))
        ) {
          void (async () => {
            const completedMessages = messagesRef.current.some((item) => item.id === message.id)
              ? messagesRef.current
              : [...messagesRef.current, message];
            pendingTemplateParserRef.current(completedMessages, false);
            await workbenchStore.waitForExecutionQueue();

            const projectFiles = Object.entries(workbenchStore.files.get()).flatMap(([path, file]) =>
              file?.type === 'file' ? [{ path, content: file.content }] : [],
            );

            // A research-only conversation has no project to install or start.
            if (projectFiles.length === 0) {
              return;
            }

            const commands = await detectProjectCommands(projectFiles);
            const setupMessage = createCommandsMessage(commands);

            if (setupMessage) {
              /*
               * This append happens after an await, so the persistence sampler has already pushed
               * the turn (and may not run again: it skips a save when the list is unchanged since
               * load). Persist explicitly with the setup message included, otherwise a chat whose
               * only install/start record was synthesised here reloads without it.
               */
              const nextMessages = [...messagesRef.current.filter((item) => item.id !== setupMessage.id), setupMessage];

              setMessages(nextMessages);
              await storeMessageHistory(nextMessages).catch((error) => toast.error(error.message));
            }
          })();
        }

        console.log('Chat response completed');
        logStore.logProvider('Chat response completed', {
          component: 'Chat',
          action: 'response',
          model,
          provider: provider.name,
          messageLength: getMessageText(message).length,
        });

        logger.debug('Finished streaming');
      },

      /*
       * `messages`, not `initialMessages`. The old key is spread into the Chat
       * constructor and discarded, so persisted history never reached the UI.
       */
      messages: initialMessages,
    });

    const isLoading = status === 'submitted' || status === 'streaming';
    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    const executingProjectCallsRef = useRef(new Set<string>());
    const projectToolControllersRef = useRef(new Map<string, AbortController>());
    const projectCallGenerationsRef = useRef(new Map<string, { generation: number; chatId?: string }>());
    const currentProjectGeneration = workbenchStore.projectGeneration.get();

    useEffect(() => {
      const unsubscribe = workbenchStore.projectGeneration.listen(() => {
        for (const controller of projectToolControllersRef.current.values()) {
          controller.abort();
        }
        projectToolControllersRef.current.clear();
      });

      return () => {
        unsubscribe();

        for (const controller of projectToolControllersRef.current.values()) {
          controller.abort();
        }
        projectToolControllersRef.current.clear();
      };
    }, []);

    for (const message of messages) {
      for (const part of getMessageParts(message) ?? []) {
        const callId = getToolCallId(part);
        const name = getToolName(part);

        if (
          callId &&
          name &&
          PROJECT_TOOL_NAMES.includes(name as (typeof PROJECT_TOOL_NAMES)[number]) &&
          !projectCallGenerationsRef.current.has(callId)
        ) {
          projectCallGenerationsRef.current.set(callId, { generation: currentProjectGeneration, chatId: chatId.get() });
        }
      }
    }

    const handleToolOutput = useCallback(
      (options: { tool: string; toolCallId: string; output: unknown }) => {
        const { tool, toolCallId, output } = options;

        // Await the server's result; a local approval would overwrite it and prematurely continue the chat.
        if (isServerAgentTool(tool)) {
          return;
        }

        if (tool.startsWith('plugin_')) {
          if (output !== TOOL_EXECUTION_APPROVAL.APPROVE) {
            addToolOutput({
              ...options,
              output: { isError: true, denied: true, error: 'Plugin tool execution was rejected.' },
            });
            return;
          }

          const call = messagesRef.current
            .flatMap((message) => getMessageParts(message) ?? [])
            .find((part) => isToolCallPart(part) && getToolCallId(part) === toolCallId);

          const input = call ? getToolInput(call) : undefined;

          void pluginDatabase
            .getAll()
            .then((installedPlugins) => {
              for (const installed of installedPlugins) {
                if (!installed.enabled) {
                  continue;
                }

                const parsed = pluginManifestSchema.safeParse(installed.manifest);

                if (!parsed.success || !isSupportedAdapter(parsed.data)) {
                  continue;
                }

                const manifest = parsed.data;
                const toolId = manifest.tools.find((candidate) => getPluginToolName(manifest.id, candidate) === tool);

                if (!toolId || installed.configuration[`toolDisabled:${toolId}`] === true) {
                  continue;
                }

                const result = executeTextUtility(toolId, input);
                addToolOutput({ tool, toolCallId, output: result });

                return;
              }

              addToolOutput({
                tool,
                toolCallId,
                output: { isError: true, error: 'This plugin tool is no longer installed, enabled, or permitted.' },
              });
            })
            .catch((error) => {
              addToolOutput({
                tool,
                toolCallId,
                output: { isError: true, error: error instanceof Error ? error.message : 'Plugin tool failed.' },
              });
            });

          return;
        }

        if (
          PROJECT_TOOL_NAMES.includes(tool as (typeof PROJECT_TOOL_NAMES)[number]) &&
          output === TOOL_EXECUTION_APPROVAL.REJECT &&
          executingProjectCallsRef.current.has(toolCallId)
        ) {
          return;
        }

        if (
          !PROJECT_TOOL_NAMES.includes(tool as (typeof PROJECT_TOOL_NAMES)[number]) ||
          output !== TOOL_EXECUTION_APPROVAL.APPROVE
        ) {
          addToolOutput(
            PROJECT_TOOL_NAMES.includes(tool as (typeof PROJECT_TOOL_NAMES)[number]) &&
              output === TOOL_EXECUTION_APPROVAL.REJECT
              ? { ...options, output: { isError: true, denied: true, error: 'Tool execution was rejected.' } }
              : options,
          );
          return;
        }

        if (executingProjectCallsRef.current.has(toolCallId)) {
          return;
        }

        let input: unknown;

        for (const message of messagesRef.current) {
          const parts = getMessageParts(message) ?? [];
          const call = parts.find((part) => isToolCallPart(part) && getToolCallId(part) === toolCallId);

          if (call) {
            input = getToolInput(call);
            break;
          }
        }

        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          addToolOutput({
            tool,
            toolCallId,
            output: { isError: true, error: 'Approved tool input was not available.' },
          });
          return;
        }

        executingProjectCallsRef.current.add(toolCallId);

        const origin = projectCallGenerationsRef.current.get(toolCallId);

        const executionContext = resolveProjectCallContext(
          origin,
          { generation: workbenchStore.projectGeneration.get(), chatId: chatId.get() },
          chatChanged,
        );

        if (origin && !executionContext) {
          addToolOutput({
            tool,
            toolCallId,
            output: { isError: true, error: 'The active project changed before this approval.' },
          });
          return;
        }

        const abortController = new AbortController();
        projectToolControllersRef.current.set(toolCallId, abortController);
        void callProjectMcpTool(tool, input as Record<string, unknown>, {
          signal: abortController.signal,
          generation: executionContext?.generation,
          chatId: executionContext?.chatId,
        })
          .then((result) => {
            if (abortController.signal.aborted) {
              return;
            }

            const mcpResult = result as unknown as {
              content?: Array<{ type: string; text?: string }>;
              structuredContent?: Record<string, unknown>;
              isError?: boolean;
            };
            const resultText = (mcpResult.content ?? [])
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n');
            const toolOutput = mcpResult.isError
              ? {
                  ...mcpResult.structuredContent,
                  isError: true,
                  error: mcpResult.structuredContent?.error ?? (resultText || 'Project MCP tool failed.'),
                }
              : (mcpResult.structuredContent ?? { content: mcpResult.content ?? [] });
            addToolOutput({ tool, toolCallId, output: toolOutput });
          })
          .catch((error) => {
            if (abortController.signal.aborted) {
              return;
            }

            addToolOutput({
              tool,
              toolCallId,
              output: { isError: true, error: error instanceof Error ? error.message : String(error) },
            });
          })
          .finally(() => {
            executingProjectCallsRef.current.delete(toolCallId);
            projectToolControllersRef.current.delete(toolCallId);
          });
      },
      [addToolOutput, chatChanged],
    );

    useEffect(() => {
      const pendingMessage = pendingTemplateContinuationRef.current;

      if (
        !pendingMessage ||
        !messages.some((message) => getMessageText(message).includes('<boltArtifact id="imported-files"'))
      ) {
        return;
      }

      pendingTemplateContinuationRef.current = null;

      void (async () => {
        /*
         * Wait for imported files to reach the project before asking the model
         * to customize them. Dependency installation and server startup remain
         * queued afterward and do not delay the first response.
         */
        try {
          parseMessages(messages, false);
          await workbenchStore.waitForFileActions();
          await sendChatMessage(pendingMessage);
        } catch (error) {
          handleError(error, 'chat');
        } finally {
          setFakeLoading(false);
        }
      })();
    }, [messages, sendChatMessage]);

    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        void sendChatMessage(
          createMessage({
            role: 'user',
            text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
          }) as any,
        );
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages, resetParsedMessages } = useMessageParser();
    pendingTemplateParserRef.current = parseMessages;

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      const sameChatRefresh = shouldPreserveChatMessagesOnRefresh({
        chatChanged,
        currentMessageCount: messagesRef.current.length,
        storedMessageCount: initialMessages.length,
        hasAppliedInitialMessages: hasAppliedInitialMessagesRef.current,
      });

      if (sameChatRefresh) {
        /*
         * Saving a new chat updates its route and re-reads the same messages.
         * Keep the live useChat state so this refresh cannot abort a new build.
         */
        setChatStarted(true);
        chatStore.setKey('started', true);

        return;
      }

      if (isLoading) {
        stop();
      }

      setMessages(initialMessages);

      const hasMessages = initialMessages.length > 0;
      setChatStarted(hasMessages);
      chatStore.setKey('started', hasMessages);
      setProgressAnnotations([]);
      resetEnhancer();

      if (!hasMessages) {
        setInput('');
      }

      /*
       * The parser only emits each artifact and action once per message id, so
       * only a genuine switch needs it rewound. A re-read of the same chat, e.g.
       * the route catching up with the chat just persisted, must leave it alone
       * or every action would run a second time.
       */
      if (chatChanged) {
        resetParsedMessages();
      }

      parseMessages(initialMessages, false);

      if (initialMessages.length > 0) {
        hasAppliedInitialMessagesRef.current = true;
      }
    }, [initialMessages, chatChanged]);

    useEffect(() => {
      const starterSetupMessage = initialMessages.find((message) =>
        getMessageText(message).includes('<boltArtifact id="project-setup"'),
      );

      if (
        !starterSetupMessage?.id ||
        parsedStarterSetupMessagesRef.current.has(starterSetupMessage.id) ||
        !initialMessages.some((message) => getMessageText(message).includes('<boltArtifact id="imported-files"'))
      ) {
        return undefined;
      }

      let cancelled = false;

      void workbenchStore.waitForFileActions().then(() => {
        if (!cancelled && !parsedStarterSetupMessagesRef.current.has(starterSetupMessage.id!)) {
          parsedStarterSetupMessagesRef.current.add(starterSetupMessage.id!);
          parseMessages(initialMessages, false);
        }
      });

      return () => {
        cancelled = true;
      };
    }, [initialMessages, parseMessages]);

    /*
     * Pre-fill the textarea with the follow-up prompt set by ImportZipButton before the
     * full-page navigation. Using setInput instead of append so the user confirms with
     * one Enter keystroke — avoids model-state race conditions on chat initialisation.
     */
    useEffect(() => {
      if (initialMessages.length === 0) {
        return;
      }

      const autorun = localStorage.getItem('bolt_zip_autorun');

      if (autorun) {
        localStorage.removeItem('bolt_zip_autorun');
        setInput(autorun);
      }
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        isPreparingProject: fakeLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, fakeLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    /*
     * The assistant text produced so far. A redirect hands it to the model as context, so an
     * interruption never loses what was already generated (Hermes keeps it in the checkpoint).
     */
    const currentPartialText = () => {
      /*
       * Read the LIVE list, not the render closure: during streaming the newest assistant row can be
       * one render behind, and an empty read here silently downgrades the redirect to a plain turn.
       */
      const live = messagesRef.current ?? messages;

      /*
       * Scan BACKWARDS for the newest assistant row that carries text. A turn that is busy importing
       * a template, or calling tools, has no text in its last assistant row yet, but the partial
       * answer from earlier in the same turn is exactly what a redirect must preserve.
       */
      for (let index = live.length - 1; index >= 0; index -= 1) {
        const candidate = live[index];

        if (candidate.role !== 'assistant') {
          continue;
        }

        const text = (getMessageText(candidate) ?? '').trim();

        if (text) {
          return text;
        }
      }

      return '';
    };

    /** The square button: an explicit stop. The partial text is preserved for the record. */
    const abort = () => {
      turnControlRef.current = requestStop(turnControlRef.current, currentPartialText());

      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    /**
     * Send while a generation runs: STEER or REDIRECT, never "ignore".
     *
     * With nothing streamed yet there is nothing to preserve, so the message simply starts the next
     * turn once the running one is aborted. With text on screen, the partial becomes a checkpoint,
     * the correction becomes a real user message, and the turn RESUMES from it: the behaviour the
     * user asked for, taken from Hermes' `_apply_active_turn_redirect`.
     */
    const interruptWith = async (text: string, actingGeneration: number) => {
      const partial = currentPartialText();
      const generation = generationRef.current;

      /*
       * Debug the two inputs that decide between steer and redirect. An empty `partial` silently
       * degrades the correction to a plain new turn, which is correct but looks like a lost
       * checkpoint; this line is what tells them apart.
       */
      console.debug('[turn-control] partial length', partial.length, 'generation', generation);

      if (!shouldAcceptStop(actingGeneration, generation)) {
        /* The turn this message was aimed at already ended: let it be a normal new turn. */
        return false;
      }

      if (!hasInterruptibleContent(partial)) {
        turnControlRef.current = appendSteer(turnControlRef.current, text);
        abort();

        return false;
      }

      turnControlRef.current = queueRedirect(turnControlRef.current, text);
      abort();

      const drained = drainRedirect(turnControlRef.current);
      turnControlRef.current = drained.next;

      if (!drained.text) {
        return false;
      }

      const resumed = applyRedirect(
        [{ role: 'user', content: text }],
        partial,
        `[Correction demandée par l'utilisateur pendant la génération]\n${drained.text}`,
      );

      const correctionRow = resumed[resumed.length - 1];
      const checkpoint = correctionRow.apiContent ?? correctionRow.content;
      const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${checkpoint}`;

      /* The resumed turn is a NEW generation: the aborted one must not accept any further stop. */
      generationRef.current = generation + 1;
      void sendChatMessage((await buildUserMessage(messageText)) as any);

      return true;
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (isNetworkStreamError(errorInfo.message)) {
          /*
           * The browser lost the connection while the reply was streaming
           * (Firefox: "Error in input stream"). Not a server error: the server
           * logs a normal 200. Reported to /client-report for diagnosis.
           */
          reportChatFailure(errorInfo.message, { context, provider: provider.name });
          errorType = 'network';
          title = 'Connection lost';
          errorInfo.message = `The connection was interrupted while the reply was streaming (network change, screen off or switching apps). Your project is safe: tap Continue. (${errorInfo.message})`;
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });
        setProgressAnnotations([]);
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): AnyPart[] => {
      const parts: AnyPart[] = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mediaType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        /*
         * v5 shape: mediaType plus a complete data URL. v4 stored bare base64
         * in `data`, which v5 cannot parse because it calls new URL(part.url).
         */
        parts.push({
          type: 'file',
          mediaType,
          url: imageData,
        });
      });

      return parts;
    };

    /*
     * v5 removed the Attachment type and the experimental_attachments option.
     * Uploaded files now travel as `file` parts on the message itself, with a
     * complete data URL in `url` because the server calls new URL() on it.
     */
    const filesToFileParts = async (files: File[]): Promise<AnyPart[]> => {
      if (files.length === 0) {
        return [];
      }

      return Promise.all(
        files.map(
          (file) =>
            new Promise<AnyPart>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  type: 'file',
                  mediaType: file.type,
                  filename: file.name,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );
    };

    /**
     * Start a NEW project from a design or a screenshot.
     *
     * The stack is not a per-generation choice: the project is scaffolded from a template (React +
     * TypeScript + Tailwind + shadcn/ui by default) and the image becomes the reference the agent
     * builds from, in the normal chat pipeline. That is how Bolt and Lovable both work, and it is
     * what makes the result a project you can actually develop instead of a throwaway HTML file.
     */
    const startProjectFromImage = async (args: { prompt: string; image: string; template: string }) => {
      if (isLoading) {
        return;
      }

      setFakeLoading(true);

      try {
        const title = args.prompt.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Nouveau projet';
        const temResp = await getTemplates(args.template, title);

        if (!temResp) {
          throw new Error('Le modèle de projet n’a pas pu être chargé.');
        }

        const imagePart = {
          type: 'file' as const,
          mediaType: 'image/png',
          filename: 'design.png',
          url: args.image,
        };

        const preamble = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${args.prompt}`;

        /*
         * The workspace is created by the template import; the build instruction is queued as the
         * continuation, exactly like Bolt's own starter flow, so the agent works on real files.
         */
        pendingTemplateContinuationRef.current = {
          ...(createMessage({
            role: 'user',
            text: preamble,
            flags: ['hidden', STARTER_BUILD_FLAG],
          }) as unknown as UIMessage),

          /* The design travels WITH the instruction: the agent reproduces it, it does not guess. */
          experimental_attachments: [imagePart],
        } as UIMessage;

        setMessages([
          {
            id: `1-${new Date().getTime()}`,
            role: 'user',
            content: preamble,
            parts: [...createMessageParts(preamble, [args.image]), imagePart],
          },
          {
            id: `2-${new Date().getTime()}`,
            role: 'assistant',
            content: temResp.assistantMessage,
            parts: [{ type: 'text', text: temResp.assistantMessage }],
          },
        ] as any);

        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);
        resetEnhancer();
        textareaRef.current?.blur();
      } catch (cause) {
        handleError(cause, 'chat');
        setFakeLoading(false);
      }
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      /*
       * A send while a generation runs is a CORRECTION, not a dropped message and not a plain stop:
       * the partial answer is kept as context and the turn resumes from the user's words. With no
       * text produced yet there is nothing to keep, so it becomes the next turn. The square button
       * stays the explicit stop.
       */
      if (isLoading) {
        /*
         * Observability for the interruption path: without it a silent no-op is indistinguishable
         * from a dropped message (this cost a whole debug cycle). Console only, no payload.
         */
        console.debug('[turn-control] send during generation', {
          generation: generationRef.current,
          hasPartial: hasInterruptibleContent(currentPartialText()),
        });

        /*
         * `generationRef` already identifies the RUNNING turn here; it is bumped below only when
         * this really becomes a new turn. Passing it through is what makes the stale-stop guard
         * meaningful: a correction aimed at a finished turn falls through instead of aborting.
         */
        const handled = await interruptWith(messageContent, generationRef.current);

        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        if (handled) {
          return;
        }

        /* Nothing was on screen: fall through so the message starts the next turn once aborted. */
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        const encodedElement = encodeURIComponent(JSON.stringify(selectedElement)).replace(/'/g, '%27');
        const elementInfo = `<div class=\"__boltSelectedElement__\" data-element=\"${encodedElement}\"></div>`;

        const visualEditPrompt = selectedElement.visualEdits?.length
          ? `\nPlease apply these visual edits to the selected element in the project source: ${selectedElement.visualEdits
              .map(({ property, value }) => `${property} = ${JSON.stringify(value)}`)
              .join(', ')}.`
          : '';
        finalMessageContent = `${messageContent}${visualEditPrompt}${elementInfo}`;
      }

      runAnimation();

      if (!chatStarted) {
        setFakeLoading(true);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

              generationRef.current += 1;
              pendingTemplateContinuationRef.current = createMessage({
                role: 'user',
                text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}\n\nOriginal request:\n${finalMessageContent}`,
                flags: ['hidden', STARTER_BUILD_FLAG],
              }) as unknown as UIMessage;

              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: userMessageText,
                  parts: createMessageParts(userMessageText, imageDataList),
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                  parts: [{ type: 'text', text: assistantMessage }],
                },
              ] as any);
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              resetEnhancer();

              textareaRef.current?.blur();

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const fileParts = await filesToFileParts(uploadedFiles);

        void sendChatMessage({
          id: `${new Date().getTime()}`,
          role: 'user',
          content: userMessageText,
          parts: [...createMessageParts(userMessageText, imageDataList), ...fileParts],
        } as any);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(dropFailedTurn(messages));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        void sendChatMessage((await buildUserMessage(messageText)) as any);

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        void sendChatMessage((await buildUserMessage(messageText)) as any);
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /*
     * Builds a user message carrying its images and uploads. v5 removed
     * experimental_attachments, so file parts must be part of the message
     * itself; omitting them silently dropped every paste and upload, because
     * the state is cleared right after sending.
     */
    const buildUserMessage = async (text: string): Promise<UIMessage> => {
      const fileParts = await filesToFileParts(uploadedFiles);

      return {
        ...createMessage({ role: 'user', text }),
        parts: [...createMessageParts(text, imageDataList), ...fileParts],
      } as unknown as UIMessage;
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(event.target.value);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }

      const handleApiKeysUpdated = (event: Event) => {
        const { apiKeys } = (event as CustomEvent<ApiKeysUpdatedDetail>).detail;
        setApiKeys(apiKeys);
      };

      window.addEventListener(API_KEYS_UPDATED_EVENT, handleApiKeysUpdated);

      return () => window.removeEventListener(API_KEYS_UPDATED_EVENT, handleApiKeysUpdated);
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            parsedContent: parsedMessages[i] || '',
          };
        })}

        /*
         * Markdown's quick-action buttons (__boltQuickAction__) call append to
         * re-send a message. Without this they rendered but did nothing.
         */
        append={(message) => sendChatMessage(message as UIMessage)}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        deployAlert={deployAlert}
        _clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        llmErrorAlert={llmErrorAlert}
        clearLlmErrorAlert={clearApiErrorAlert}
        progressAnnotations={progressAnnotations}
        chatMode={chatMode}
        setChatMode={setChatMode}
        agentMode={agentMode}
        setAgentMode={(enabled) => {
          setAgentMode(enabled);
          Cookies.set('agentMode', String(enabled), { expires: 30 });
        }}
        designScheme={designScheme}
        onStartProject={startProjectFromImage}
        setDesignScheme={setDesignScheme}
        selectedElement={selectedElement}
        setSelectedElement={setSelectedElement}
        addToolOutput={handleToolOutput}
      />
    );
  },
);
