import { useStore } from '@nanostores/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { UIMessage } from 'ai';
import Cookies from 'js-cookie';
import React, { lazy, Suspense, type RefCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { getApiKeysFromCookies } from './APIKeyManager';
import styles from './BaseChat.module.scss';
import ChatAlert from './ChatAlert';
import { ChatBox, type StartProjectArgs } from './ChatBox';
import { ConnectToolsPill } from './ConnectToolsPill';
import { HomeHeroText, HomeImportActions } from './HomeIntro';
import LlmErrorAlert from './LLMApiAlert';
import { Messages, type DisplayMessage } from './Messages.client';
import ProgressCompilation from './ProgressCompilation';
import { ToolApprovalTray } from './ToolApprovalTray';
import DeployChatAlert from '~/components/deploy/DeployAlert';
import { Menu } from '~/components/sidebar/Menu.client';
import type { ElementInfo } from '~/components/workbench/Inspector';
import { WorkbenchReopenButton } from '~/components/workbench/WorkbenchReopenButton';
import { API_KEYS_UPDATED_EVENT, type ApiKeysUpdatedDetail } from '~/lib/api/apiKeys';

const LazyWorkbench = lazy(() =>
  import('~/components/workbench/Workbench.client').then((m) => ({ default: m.Workbench })),
);
import { StickToBottom, useStickToBottomContext } from '~/lib/hooks';
import { useSpeechRecognition } from '~/lib/hooks/useSpeechRecognition';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { DebugScope } from '~/lib/persistence/debugChat';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { workbenchStore } from '~/lib/stores/workbench';
import type { ActionAlert, DeployAlert, LlmErrorAlertType } from '~/types/actions';
import type { ProgressAnnotation } from '~/types/context';
import type { DesignScheme } from '~/types/design-scheme';
import type { ProviderInfo } from '~/types/model';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';

const TEXTAREA_MIN_HEIGHT = 76;

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  messages?: DisplayMessage[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: UIMessage[]) => Promise<void>;
  exportChat?: () => void;

  /** Set when this conversation is a debug session; renders the warning banner. */
  debugScope?: DebugScope;
  uploadedFiles?: File[];
  setUploadedFiles?: React.Dispatch<React.SetStateAction<File[]>>;
  imageDataList?: string[];
  setImageDataList?: React.Dispatch<React.SetStateAction<string[]>>;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
  deployAlert?: DeployAlert;
  _clearDeployAlert?: () => void;
  llmErrorAlert?: LlmErrorAlertType;
  clearLlmErrorAlert?: () => void;
  progressAnnotations?: ProgressAnnotation[];
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  agentMode?: boolean;
  setAgentMode?: (enabled: boolean) => void;
  append?: (message: UIMessage) => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: (element: ElementInfo | null) => void;
  addToolOutput?: (options: { tool: string; toolCallId: string; output: unknown }) => void;

  /** Start a new project from a design or a screenshot (template + agent build). */
  onStartProject?: (args: StartProjectArgs) => void;
  hasProjectFiles?: boolean;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      onStreamingChange,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',
      enhancingPrompt,
      handleInputChange,

      // promptEnhanced,
      enhancePrompt,
      sendMessage,
      handleStop,
      importChat,
      exportChat,
      debugScope,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
      actionAlert,
      clearAlert,
      deployAlert,
      _clearDeployAlert,
      llmErrorAlert,
      clearLlmErrorAlert,
      progressAnnotations: incomingProgressAnnotations,
      chatMode,
      setChatMode,
      agentMode,
      setAgentMode,
      append,
      designScheme,
      setDesignScheme,
      selectedElement,
      setSelectedElement,
      addToolOutput = () => {
        throw new Error('addToolOutput not implemented');
      },
      onStartProject,
      hasProjectFiles = false,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const [apiKeys, setApiKeys] = useState<Record<string, string>>(getApiKeysFromCookies());
    const [modelList, setModelList] = useState<ModelInfo[]>([]);

    // Collapsed by default: the toolbar's model chip opens provider/model/API key settings.
    const [isModelSettingsCollapsed, setIsModelSettingsCollapsed] = useState(true);
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');

    const expoUrl = useStore(expoUrlAtom);
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const chatColumnRef = React.useRef<HTMLDivElement | null>(null);

    /*
     * Publish where the chat column sits, so the fixed composer follows it.
     *
     * The composer is `position: fixed` (see `.bolt-composer-dock` in `app/styles/index.scss`): it is
     * viewport chrome, because every in-flow wrapper here stretches to the transcript's height and a
     * sticky child then pins only at the very end of the conversation. Fixed positioning needs the
     * column's left edge and width, which change when the workbench opens, hides the chat, or the
     * window resizes. A ResizeObserver covers all three without re-rendering the tree.
     */
    React.useEffect(() => {
      const column = chatColumnRef.current;

      if (!column || typeof window === 'undefined') {
        return undefined;
      }

      const publish = () => {
        const rect = column.getBoundingClientRect();
        document.documentElement.style.setProperty('--chat-fixed-left', `${Math.round(rect.left)}px`);
        document.documentElement.style.setProperty('--chat-fixed-width', `${Math.round(rect.width)}px`);
      };

      publish();

      const observer = new ResizeObserver(publish);
      observer.observe(column);
      window.addEventListener('resize', publish);

      return () => {
        observer.disconnect();
        window.removeEventListener('resize', publish);
      };
    }, []);

    useEffect(() => {
      if (expoUrl) {
        setQrModalOpen(true);
      }
    }, [expoUrl]);

    useEffect(() => {
      onStreamingChange?.(isStreaming);
    }, [isStreaming, onStreamingChange]);

    // Dictation: appends to the typed text, French by default, disabled where unsupported.
    const {
      supported: speechSupported,
      isListening,
      isTranscribing: speechTranscribing,
      engine: speechEngine,
      errorMessage: speechError,
      clearError: clearSpeechError,
      settings: dictationSettings,
      updateSettings: updateDictationSettings,
      startListening,
      stopListening,
      abortListening,
    } = useSpeechRecognition({
      input,
      onTranscript: (text) => {
        handleInputChange?.({ target: { value: text } } as React.ChangeEvent<HTMLTextAreaElement>);
      },
    });

    useEffect(() => {
      if (typeof window !== 'undefined') {
        let parsedApiKeys: Record<string, string> | undefined = {};

        try {
          parsedApiKeys = getApiKeysFromCookies();
          setApiKeys(parsedApiKeys);
        } catch (error) {
          console.error('Error loading API keys from cookies:', error);
          Cookies.remove('apiKeys');
        }

        setIsModelLoading('all');

        if (!providerList?.length) {
          setModelList([]);
          setIsModelLoading(undefined);

          return;
        }

        const activeProviderNames = providerList.map((activeProvider) => activeProvider.name).join(',');

        fetch(`/api/models?providers=${encodeURIComponent(activeProviderNames)}`)
          .then((response) => response.json())
          .then((data) => {
            const typedData = data as { modelList: ModelInfo[] };
            setModelList(typedData.modelList);
          })
          .catch((error) => {
            console.error('Error fetching model list:', error);
          })
          .finally(() => {
            setIsModelLoading(undefined);
          });
      }
    }, [providerList, provider]);

    const onApiKeysChange = async (providerName: string, apiKey: string) => {
      const newApiKeys = { ...apiKeys, [providerName]: apiKey };
      setApiKeys(newApiKeys);
      Cookies.set('apiKeys', JSON.stringify(newApiKeys));

      setIsModelLoading(providerName);

      let providerModels: ModelInfo[] = [];

      try {
        const response = await fetch(`/api/models/${encodeURIComponent(providerName)}`);
        const data = await response.json();
        providerModels = (data as { modelList: ModelInfo[] }).modelList;
      } catch (error) {
        console.error('Error loading dynamic models for:', providerName, error);
      }

      // Only update models for the specific provider
      setModelList((prevModels) => {
        const otherModels = prevModels.filter((model) => model.provider !== providerName);
        return [...otherModels, ...providerModels];
      });
      setIsModelLoading(undefined);
    };

    useEffect(() => {
      const handleApiKeysUpdated = (event: Event) => {
        const { apiKeys, providerName } = (event as CustomEvent<ApiKeysUpdatedDetail>).detail;
        setApiKeys(apiKeys);
        setIsModelLoading(providerName);

        fetch(`/api/models/${encodeURIComponent(providerName)}`)
          .then((response) => response.json())
          .then((data) => {
            const providerModels = (data as { modelList: ModelInfo[] }).modelList;
            setModelList((currentModels) => [
              ...currentModels.filter((model) => model.provider !== providerName),
              ...providerModels,
            ]);
          })
          .catch((error) => {
            console.error('Error loading dynamic models for:', providerName, error);
          })
          .finally(() => setIsModelLoading(undefined));
      };

      window.addEventListener(API_KEYS_UPDATED_EVENT, handleApiKeysUpdated);

      return () => window.removeEventListener(API_KEYS_UPDATED_EVENT, handleApiKeysUpdated);
    }, []);

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      if (sendMessage) {
        sendMessage(event, messageInput);
        setSelectedElement?.(null);

        if (speechSupported) {
          abortListening(); // Stop current recognition

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleFileUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          const reader = new FileReader();

          reader.onload = (e) => {
            const base64Image = e.target?.result as string;

            // Functional updates: a list captured before the async read would drop other images.
            setUploadedFiles?.((prev) => [...prev, file]);
            setImageDataList?.((prev) => [...prev, base64Image]);
          };
          reader.readAsDataURL(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            const reader = new FileReader();

            reader.onload = (e) => {
              const base64Image = e.target?.result as string;
              setUploadedFiles?.((prev) => [...prev, file]);
              setImageDataList?.((prev) => [...prev, base64Image]);
            };
            reader.readAsDataURL(file);
          }

          break;
        }
      }
    };

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full min-h-0 w-full overflow-hidden')}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        {chatStarted && showChat && !showWorkbench && (
          <WorkbenchReopenButton onClick={() => workbenchStore.showWorkbench.set(true)} />
        )}
        {/*
         * The row is a layout box, not a scroller: the chat column owns the vertical scroll so the
         * composer can pin inside it, and the workbench keeps its own internal scrollers. With
         * `overflow-y-auto h-full` here the row grew to the file tree's height (measured 15482px),
         * so both columns measured 100% of THAT, and the sticky composer sat ~15000px down the page.
         * `min-w-0` lets the row shrink below its children's intrinsic width.
         */}
        <div className="flex flex-col lg:flex-row w-full h-full min-h-0 min-w-0 overflow-hidden">
          <div
            ref={chatColumnRef}
            className={classNames(
              styles.Chat,

              /*
               * h-full only from lg: below that the row is an auto-height flex-col, so h-full would
               * resolve against it and grow a 100vh scroller with the file tree's height, pushing
               * the composer (sticky) many screens below the viewport.
               */
              'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] lg:h-full lg:min-h-0 min-h-0',
            )}
          >
            {debugScope && <DebugSessionBanner scope={debugScope} />}
            {!chatStarted && (
              <div id="intro" className="mt-[8vh] lg:mt-[12vh] max-w-2xl mx-auto text-center px-4 lg:px-0">
                <ConnectToolsPill />
                <HomeHeroText />
              </div>
            )}
            <StickToBottom
              className={classNames('pt-6 px-2 sm:px-6 relative', {
                'flex-1 min-h-0 flex flex-col modern-scrollbar': chatStarted,
              })}
              resize="smooth"
              initial="smooth"
            >
              <StickToBottom.Content className="flex flex-col gap-4 relative ">
                <ClientOnly>
                  {() => {
                    return chatStarted ? (
                      <Messages
                        className="flex flex-col w-full flex-1 max-w-chat pb-4 mx-auto z-1"
                        messages={messages}
                        isStreaming={isStreaming}
                        append={append}
                        chatMode={chatMode}
                        setChatMode={setChatMode}
                        provider={provider}
                        model={model}
                        addToolResult={addToolOutput}
                      />
                    ) : null;
                  }}
                </ClientOnly>
                {/* Reserves the fixed composer's height so the last message is not hidden behind it. */}
                {chatStarted && <div className="shrink-0 h-[var(--composer-space,9.5rem)]" aria-hidden="true" />}
                {/* Last: it is outside the transcript's padding, and drawn above the composer band. */}
                <ScrollToBottom />
              </StickToBottom.Content>
              <div
                className={classNames('flex flex-col w-full mx-auto', {
                  'bolt-composer-dock': chatStarted,
                  'my-auto max-w-[44rem] z-prompt': !chatStarted,
                })}
                data-testid="composer-column"
              >
                <div
                  className={classNames('w-full mx-auto pointer-events-auto', {
                    /*
                     * No bottom padding when docked: the dock already carries the gap to the
                     * viewport edge, and the two together (24 + 8) pushed the composer's bottom
                     * 15px above the terminal panel's, which reads as "not aligned" on a
                     * two-column layout. Aligned means one number: the dock's padding.
                     */
                    'max-w-chat mt-auto': chatStarted,
                  })}
                  data-testid="composer-sticky"
                >
                  <div className="flex flex-col gap-2">
                    {deployAlert && (
                      <DeployChatAlert
                        alert={deployAlert}
                        clearAlert={() => _clearDeployAlert?.()}
                        postMessage={(message: string | undefined) => {
                          sendMessage?.({} as any, message);
                        }}
                      />
                    )}
                    {actionAlert && (
                      <ChatAlert
                        alert={actionAlert}
                        clearAlert={() => clearAlert?.()}
                        postMessage={(message) => {
                          sendMessage?.({} as any, message);
                          clearAlert?.();
                        }}
                      />
                    )}
                    {llmErrorAlert && (
                      <LlmErrorAlert
                        alert={llmErrorAlert}
                        clearAlert={() => clearLlmErrorAlert?.()}
                        onContinue={() => {
                          clearLlmErrorAlert?.();
                          sendMessage?.({} as any, 'Continue where you stopped.');
                        }}
                      />
                    )}
                  </div>
                  <ToolApprovalTray messages={messages} addToolOutput={addToolOutput} />
                  {incomingProgressAnnotations && <ProgressCompilation data={incomingProgressAnnotations} />}
                  <ChatBox
                    isModelSettingsCollapsed={isModelSettingsCollapsed}
                    setIsModelSettingsCollapsed={setIsModelSettingsCollapsed}
                    provider={provider}
                    setProvider={setProvider}
                    providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
                    model={model}
                    setModel={setModel}
                    modelList={modelList}
                    apiKeys={apiKeys}
                    isModelLoading={isModelLoading}
                    onApiKeysChange={onApiKeysChange}
                    uploadedFiles={uploadedFiles}
                    setUploadedFiles={setUploadedFiles}
                    imageDataList={imageDataList}
                    setImageDataList={setImageDataList}
                    textareaRef={textareaRef}
                    input={input}
                    handleInputChange={handleInputChange}
                    handlePaste={handlePaste}
                    TEXTAREA_MIN_HEIGHT={TEXTAREA_MIN_HEIGHT}
                    TEXTAREA_MAX_HEIGHT={TEXTAREA_MAX_HEIGHT}
                    isStreaming={isStreaming}
                    handleStop={handleStop}
                    handleSendMessage={handleSendMessage}
                    enhancingPrompt={enhancingPrompt}
                    enhancePrompt={enhancePrompt}
                    isListening={isListening}
                    speechSupported={speechSupported}
                    speechEngine={speechEngine}
                    speechTranscribing={speechTranscribing}
                    speechError={speechError}
                    clearSpeechError={clearSpeechError}
                    dictationSettings={dictationSettings}
                    updateDictationSettings={updateDictationSettings}
                    startListening={startListening}
                    stopListening={stopListening}
                    chatStarted={chatStarted}
                    exportChat={exportChat}
                    qrModalOpen={qrModalOpen}
                    setQrModalOpen={setQrModalOpen}
                    handleFileUpload={handleFileUpload}
                    onStartProject={onStartProject}
                    hasProjectFiles={hasProjectFiles}
                    chatMode={chatMode}
                    setChatMode={setChatMode}
                    agentMode={agentMode}
                    setAgentMode={setAgentMode}
                    designScheme={designScheme}
                    setDesignScheme={setDesignScheme}
                    selectedElement={selectedElement}
                    setSelectedElement={setSelectedElement}
                  />
                </div>
              </div>
            </StickToBottom>
            {!chatStarted && (
              <div className="flex flex-col items-center gap-8 px-4 pb-[var(--mobile-nav-space)] md:pb-12 w-full">
                <HomeImportActions importChat={importChat} />
              </div>
            )}
          </div>
          <ClientOnly>
            {() => (
              <Suspense fallback={null}>
                <LazyWorkbench
                  chatStarted={chatStarted}
                  isStreaming={isStreaming}
                  selectedElement={selectedElement}
                  setSelectedElement={setSelectedElement}
                  exportChat={exportChat}
                />
              </Suspense>
            )}
          </ClientOnly>
        </div>
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  /*
   * The button used to sit INSIDE the scrolling transcript with `sticky z-50 bottom-0`: because it
   * was the last child of the scroll container, "sticky" kept it pinned 5px below the container's
   * bottom edge, which put it under the fixed composer (z-prompt), half hidden and unclickable.
   * It is chrome like the composer, so it leaves the flow entirely and is anchored to the bottom
   * of the chat column, just above the composer's reserved band, in a layer that stays under the
   * composer and never covers it.
   */
  return (
    !isAtBottom && (
      <div className="bolt-scroll-to-bottom">
        <button
          type="button"
          className="rounded-lg px-1.5 py-0.5 flex items-center justify-center gap-2 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm shadow-md hover:bg-bolt-elements-background-depth-3"
          onClick={() => scrollToBottom()}
        >
          Aller au dernier message
          <span className="i-ph:arrow-down animate-bounce" />
        </button>
      </div>
    )
  );
}

/**
 * Says, above the conversation, that it is a debug session.
 *
 * The sidebar chip is the primary mark, but it is out of sight while working: a debug run
 * that lands in the project you are looking at looks like your own project, and reopening a
 * real site from a mislabelled entry is how a correction ends up applied to the wrong one.
 */
function DebugSessionBanner({ scope }: { scope: DebugScope }) {
  return (
    <div
      role="status"
      data-testid="debug-session-banner"
      className="mx-2 mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
    >
      <span className="font-semibold uppercase tracking-wide">{scope === 'probe' ? 'Sonde' : 'Session de debug'}</span>
      {' — '}
      {scope === 'probe'
        ? 'conversation de test sans projet. Rien de ce qui est ici ne sera publié.'
        : 'conversation créée par un test automatisé, identifiable dans la liste par son étiquette sonde ou debug.'}
    </div>
  );
}
