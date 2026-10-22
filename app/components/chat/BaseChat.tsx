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
import GitCloneButton from './GitCloneButton';
import LlmErrorAlert from './LLMApiAlert';
import { Messages, type DisplayMessage } from './Messages.client';
import ProgressCompilation from './ProgressCompilation';
import { ToolApprovalTray } from './ToolApprovalTray';
import { ImportFolderButton } from '~/components/chat/ImportFolderButton';
import { ImportZipButton } from '~/components/chat/ImportZipButton';
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
import { profileStore } from '~/lib/stores/profile';
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
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
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
            {!chatStarted && (
              <div id="intro" className="mt-[8vh] lg:mt-[12vh] max-w-2xl mx-auto text-center px-4 lg:px-0">
                <ConnectToolsPill />
                <h1 className="text-[2rem] leading-[1.1] sm:text-5xl font-semibold tracking-[-0.03em] text-bolt-elements-textPrimary mb-3 animate-fade-in">
                  <HeroTitle />
                </h1>
                <p className="text-base sm:text-lg mb-8 text-bolt-elements-textSecondary animate-fade-in animation-delay-200">
                  Describe your app and Bolt builds it, live, in your browser.
                </p>
              </div>
            )}
            <StickToBottom
              className={classNames('pt-6 px-2 sm:px-6 relative', {
                'h-full flex flex-col modern-scrollbar': chatStarted,
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
                <ScrollToBottom />
                {/* Reserves the fixed composer's height so the last message is not hidden behind it. */}
                {chatStarted && <div className="shrink-0 h-[var(--composer-space,9.5rem)]" aria-hidden="true" />}
              </StickToBottom.Content>
              <div
                className={classNames('flex flex-col w-full mx-auto mb-6', {
                  'bolt-composer-dock': chatStarted,
                  'my-auto max-w-[44rem] z-prompt': !chatStarted,
                })}
                data-testid="composer-column"
              >
                <div
                  className={classNames('w-full mx-auto pointer-events-auto', {
                    'max-w-chat pb-2 mt-auto': chatStarted,
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
                <div
                  className="flex flex-wrap justify-center items-center gap-1 text-sm text-[#1c1c1c]/80 dark:text-white/80"
                  aria-label="Import an existing project"
                  role="group"
                >
                  <span className="mr-1">or import</span>
                  <ImportFolderButton importChat={importChat} className={SECONDARY_ACTION} />
                  <ImportZipButton importChat={importChat} className={SECONDARY_ACTION} />
                  <GitCloneButton importChat={importChat} className={SECONDARY_ACTION} />
                </div>
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

/*
 * Secondary landing actions (import folder / ZIP / clone) as quiet ghost
 * buttons, so they do not compete with the prompt. `!` overrides the default
 * Button styles, since classNames() concatenates instead of merging.
 */
const SECONDARY_ACTION = classNames(
  '!h-8 !min-w-0 !px-2.5 !py-1 !gap-1.5 !text-sm !font-normal !rounded-lg',

  // Sits on the landing wash: near-black / near-white text keeps AA contrast on the pink band.
  '!bg-transparent !border-transparent !text-[#1c1c1c] dark:!text-white',
  'hover:!bg-white/60 dark:hover:!bg-white/10',
  'focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-accent-500',
);

/*
 * Lovable greets the user by name. Client-only (the profile lives in
 * localStorage), so the server render shows the generic title.
 */
function HeroTitle() {
  const profile = useStore(profileStore);
  const name = profile?.username?.trim();

  return <>{name ? `What will you build, ${name}?` : 'What will you build today?'}</>;
}

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  return (
    !isAtBottom && (
      <>
        <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-bolt-elements-background-depth-1 to-transparent h-20 z-10" />
        <button
          className="sticky z-50 bottom-0 left-0 right-0 text-4xl rounded-lg px-1.5 py-0.5 flex items-center justify-center mx-auto gap-2 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm"
          onClick={() => scrollToBottom()}
        >
          Go to last message
          <span className="i-ph:arrow-down animate-bounce" />
        </button>
      </>
    )
  );
}
