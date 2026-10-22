import { useStore } from '@nanostores/react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import React from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { APIKeyManager } from './APIKeyManager';
import { AttachmentMenu } from './AttachmentMenu';
import styles from './BaseChat.module.scss';
import FilePreview from './FilePreview';
import { McpTools } from './MCPTools';
import { ScreenshotStateManager } from './ScreenshotStateManager';
import { ScreenshotToCode } from './ScreenshotToCode';
import { SendButton } from './SendButton.client';
import { SupabaseConnection } from './SupabaseConnection';
import { ToolAccessMenu } from './ToolAccessMenu';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import { CloseButton } from '~/components/ui/CloseButton';
import { ColorSchemeDialog } from '~/components/ui/ColorSchemeDialog';
import { IconButton } from '~/components/ui/IconButton';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import type { ElementInfo } from '~/components/workbench/Inspector';
import { isGitHubConnected } from '~/lib/stores/githubConnection';
import { isGitLabConnected } from '~/lib/stores/gitlabConnection';
import { useMCPStore, type ConnectorId } from '~/lib/stores/mcp';
import { netlifyConnection } from '~/lib/stores/netlify';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import { supabaseConnection } from '~/lib/stores/supabase';
import { vercelConnection } from '~/lib/stores/vercel';
import type { DesignScheme } from '~/types/design-scheme';
import type { ProviderInfo } from '~/types/model';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';

/** Read one image file as a data URL (the composer previews and sends that string). */
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Accessible screenshot-to-code dialog. Rendered through Radix Dialog (portal, focus trap,
 * Escape/close, focus restored to the element that opened it). Mounted only on the client.
 */
export function ScreenshotDialog({
  open,
  onOpenChange,
  openerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openerRef: React.MutableRefObject<HTMLElement | null>;
}) {
  return (
    <ClientOnly>
      {() => (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/30" />
            <RadixDialog.Content
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                /*
                 * Radix returns focus on close only when it knows the opener. Make the opener the
                 * element that had focus before the dialog opened (the attachment control) and
                 * stop the default, which otherwise lands on <body> once the close button unmounts.
                 */
                if (openerRef.current?.isConnected) {
                  event.preventDefault();
                  openerRef.current.focus();
                }
              }}
              className="fixed left-1/2 -translate-x-1/2 top-[calc(var(--header-height)+0.75rem)] bottom-6 w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100dvh-var(--header-height)-2rem)] overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 shadow-lg z-[1001] focus:outline-none"
            >
              <div className="flex items-center justify-between mb-3">
                <RadixDialog.Title className="text-sm font-semibold text-bolt-elements-textPrimary">
                  Depuis une capture d’écran
                </RadixDialog.Title>
                <RadixDialog.Close aria-label="Fermer le générateur de capture" className="rounded-lg">
                  <CloseButton size="sm" />
                </RadixDialog.Close>
              </div>
              <RadixDialog.Description className="sr-only">
                Générez une application à partir d’une capture d’écran ou d’une maquette.
              </RadixDialog.Description>
              <ScreenshotToCode />
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
      )}
    </ClientOnly>
  );
}

interface ChatBoxProps {
  isModelSettingsCollapsed: boolean;
  setIsModelSettingsCollapsed: (collapsed: boolean) => void;
  provider: any;
  providerList: any[];
  modelList: any[];
  apiKeys: Record<string, string>;
  isModelLoading: string | undefined;
  onApiKeysChange: (providerName: string, apiKey: string) => void;
  uploadedFiles: File[];
  imageDataList: string[];
  textareaRef: React.RefObject<HTMLTextAreaElement | null> | undefined;
  input: string;
  handlePaste: (e: React.ClipboardEvent) => void;
  TEXTAREA_MIN_HEIGHT: number;
  TEXTAREA_MAX_HEIGHT: number;
  isStreaming: boolean;
  handleSendMessage: (event: React.UIEvent, messageInput?: string) => void;
  isListening: boolean;

  /** False when the browser has no SpeechRecognition (Firefox): the mic is disabled with a reason. */
  speechSupported?: boolean;
  startListening: () => void;
  stopListening: () => void;
  chatStarted: boolean;
  exportChat?: () => void;
  qrModalOpen: boolean;
  setQrModalOpen: (open: boolean) => void;
  handleFileUpload: () => void;
  setProvider?: ((provider: ProviderInfo) => void) | undefined;
  model?: string | undefined;
  setModel?: ((model: string) => void) | undefined;
  setUploadedFiles?: React.Dispatch<React.SetStateAction<File[]>> | undefined;
  setImageDataList?: React.Dispatch<React.SetStateAction<string[]>> | undefined;
  handleInputChange?: ((event: React.ChangeEvent<HTMLTextAreaElement>) => void) | undefined;
  handleStop?: (() => void) | undefined;
  enhancingPrompt?: boolean | undefined;
  enhancePrompt?: (() => void) | undefined;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  agentMode?: boolean;
  setAgentMode?: (enabled: boolean) => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: ((element: ElementInfo | null) => void) | undefined;
}

export const ChatBox: React.FC<ChatBoxProps> = (props) => {
  const [isMcpToolsOpen, setIsMcpToolsOpen] = React.useState(false);
  const [isScreenshotOpen, setIsScreenshotOpen] = React.useState(false);
  const screenshotOpenerRef = React.useRef<HTMLElement | null>(null);
  const mcpToolsInitialized = useMCPStore((state) => state.isInitialized);
  const mcpSettings = useMCPStore((state) => state.settings);
  const setWebSearchEnabled = useMCPStore((state) => state.setWebSearchEnabled);
  const setConnectorEnabled = useMCPStore((state) => state.setConnectorEnabled);
  const serverTools = useMCPStore((state) => state.serverTools);
  const supabaseConnectionState = useStore(supabaseConnection);
  const supabaseConnected = !!supabaseConnectionState.isConnected;
  const githubConnected = useStore(isGitHubConnected);
  const gitlabConnected = useStore(isGitLabConnected);
  const vercelConnected = !!useStore(vercelConnection).user;
  const netlifyConnected = !!useStore(netlifyConnection).user;
  const browserUseCloudAvailable = serverTools['browser-use-cloud']?.status === 'available';

  const connectors = (
    [
      { id: 'github', name: 'GitHub', icon: <div className="i-ph:github-logo text-lg" />, available: githubConnected },
      {
        id: 'gitlab',
        name: 'GitLab',
        icon: <div className="i-ph:gitlab-logo text-lg" />,
        available: gitlabConnected,
      },
      {
        id: 'vercel',
        name: 'Vercel',
        icon: <div className="i-ph:triangle text-lg" />,
        available: vercelConnected,
      },
      {
        id: 'netlify',
        name: 'Netlify',
        icon: <div className="i-ph:cloud text-lg" />,
        available: netlifyConnected,
      },
      {
        id: 'supabase',
        name: 'Supabase',
        icon: <img className="w-4 h-4" height="16" width="16" src="https://cdn.simpleicons.org/supabase" alt="" />,
        available: supabaseConnected,
      },
      {
        id: 'browserUseCloud',
        name: 'Browser Use Cloud',
        icon: <div className="i-ph:browser text-lg" />,
        available: browserUseCloudAvailable,
      },
    ] as { id: ConnectorId; name: string; icon: React.ReactNode; available: boolean }[]
  )
    .filter((connector) => connector.available)
    .map(({ available: _available, ...connector }) => ({
      ...connector,
      enabled: mcpSettings.connectorEnabled[connector.id],
    }));

  React.useEffect(() => {
    const availability: Record<ConnectorId, boolean> = {
      github: githubConnected,
      gitlab: gitlabConnected,
      vercel: vercelConnected,
      netlify: netlifyConnected,
      supabase: supabaseConnected,
      browserUseCloud: browserUseCloudAvailable,
    };

    for (const [connector, available] of Object.entries(availability) as [ConnectorId, boolean][]) {
      if (!available && mcpSettings.connectorEnabled[connector]) {
        setConnectorEnabled(connector, false);
      }
    }
  }, [
    githubConnected,
    gitlabConnected,
    vercelConnected,
    netlifyConnected,
    browserUseCloudAvailable,
    mcpSettings.connectorEnabled.github,
    mcpSettings.connectorEnabled,
    setConnectorEnabled,
    supabaseConnected,
  ]);

  // Lovable: one translucent surface, large radius, soft shadow, no animated outline.
  return (
    <div
      className={classNames(
        'relative w-full mx-auto z-prompt p-2 rounded-[1.75rem]',
        'bg-white/85 dark:bg-[#1f1f22]/85 backdrop-blur-xl border border-black/[0.06] dark:border-white/10',
        'shadow-[0_1px_2px_rgba(16,24,40,0.04),0_16px_40px_-16px_rgba(16,24,40,0.22)]',
        'dark:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)]',
        'transition-[border-color,box-shadow] duration-200',
        'focus-within:border-bolt-elements-borderColorActive',

        /*
         * {
         *   'sticky bottom-2': chatStarted,
         * },
         */
      )}
    >
      <svg className={classNames(styles.PromptEffectContainer, 'hidden')}>
        <defs>
          <linearGradient
            id="line-gradient"
            x1="20%"
            y1="0%"
            x2="-14%"
            y2="10%"
            gradientUnits="userSpaceOnUse"
            gradientTransform="rotate(-45)"
          >
            <stop offset="0%" stopColor="#b44aff" stopOpacity="0%"></stop>
            <stop offset="40%" stopColor="#b44aff" stopOpacity="80%"></stop>
            <stop offset="50%" stopColor="#b44aff" stopOpacity="80%"></stop>
            <stop offset="100%" stopColor="#b44aff" stopOpacity="0%"></stop>
          </linearGradient>
          <linearGradient id="shine-gradient">
            <stop offset="0%" stopColor="white" stopOpacity="0%"></stop>
            <stop offset="40%" stopColor="#ffffff" stopOpacity="80%"></stop>
            <stop offset="50%" stopColor="#ffffff" stopOpacity="80%"></stop>
            <stop offset="100%" stopColor="white" stopOpacity="0%"></stop>
          </linearGradient>
        </defs>
        <rect className={classNames(styles.PromptEffectLine)} pathLength="100" strokeLinecap="round"></rect>
        <rect className={classNames(styles.PromptShine)} x="48" y="24" width="70" height="1"></rect>
      </svg>
      <div>
        <ClientOnly>
          {() => (
            <div className={props.isModelSettingsCollapsed ? 'hidden' : ''}>
              <ModelSelector
                key={props.provider?.name}
                model={props.model}
                setModel={props.setModel}
                modelList={props.modelList}
                provider={props.provider}
                setProvider={props.setProvider}
                providerList={props.providerList || (PROVIDER_LIST as ProviderInfo[])}
                apiKeys={props.apiKeys}
                modelLoading={props.isModelLoading}
              />
              {(props.providerList || []).length > 0 &&
                props.provider &&
                !LOCAL_PROVIDERS.includes(props.provider.name) && (
                  <APIKeyManager
                    provider={props.provider}
                    apiKey={props.apiKeys[props.provider.name] || ''}
                    setApiKey={(key) => {
                      props.onApiKeysChange(props.provider.name, key);
                    }}
                  />
                )}
            </div>
          )}
        </ClientOnly>
      </div>
      <FilePreview
        files={props.uploadedFiles}
        imageDataList={props.imageDataList}
        onRemove={(index) => {
          props.setUploadedFiles?.(props.uploadedFiles.filter((_, i) => i !== index));
          props.setImageDataList?.(props.imageDataList.filter((_, i) => i !== index));
        }}
      />
      <ClientOnly>
        {() => (
          <ScreenshotStateManager
            setUploadedFiles={props.setUploadedFiles}
            setImageDataList={props.setImageDataList}
            uploadedFiles={props.uploadedFiles}
            imageDataList={props.imageDataList}
          />
        )}
      </ClientOnly>
      {props.selectedElement && (
        <div className="flex mx-1.5 gap-2 items-center justify-between rounded-lg rounded-b-none border border-b-none border-bolt-elements-borderColor text-bolt-elements-textPrimary flex py-1 px-2.5 font-medium text-xs">
          <div className="flex gap-2 items-center lowercase">
            <code className="bg-accent-500 rounded-4px px-1.5 py-1 mr-0.5 text-white">
              {props?.selectedElement?.tagName}
            </code>
            selected for inspection
          </div>
          <button
            className="bg-transparent text-accent-500 pointer-auto"
            onClick={() => props.setSelectedElement?.(null)}
          >
            Clear
          </button>
        </div>
      )}
      <div className="relative rounded-2xl bg-transparent">
        <textarea
          ref={props.textareaRef}
          className={classNames(
            'w-full px-4 pt-4 outline-none resize-none text-bolt-elements-textPrimary placeholder-[#5f5f5d] dark:placeholder-white/55 bg-transparent text-[15px] leading-6',
            'transition-all duration-200',
            'hover:border-bolt-elements-focus',
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            e.currentTarget.style.border = '2px solid #1488fc';
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.style.border = '2px solid #1488fc';
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';
          }}
          onDrop={(e) => {
            e.preventDefault();

            // Clear the drag highlight entirely rather than pinning an inline 1px border.
            e.currentTarget.style.border = '';

            const images = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'));

            if (images.length === 0) {
              return;
            }

            /*
             * Read every image, then append them in ONE update. Each reader used to call
             * setUploadedFiles([...props.uploadedFiles, file]) with the list captured at drop
             * time, so every callback overwrote the previous one and only the last image of a
             * multi-file drop survived.
             */
            Promise.all(images.map(readImageAsDataUrl))
              .then((dataUrls) => {
                props.setUploadedFiles?.([...props.uploadedFiles, ...images]);
                props.setImageDataList?.([...props.imageDataList, ...dataUrls]);
              })
              .catch((error) => console.error('Could not read the dropped images:', error));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (event.shiftKey) {
                return;
              }

              // An IME composition owns Enter: let it confirm the candidate, nothing else.
              if (event.nativeEvent.isComposing) {
                return;
              }

              event.preventDefault();

              /*
               * Enter during a generation does nothing. It used to call handleStop(), so typing
               * the next instruction and pressing Enter aborted the running build (and its file
               * and shell actions) without sending anything. Stopping stays on the Stop button.
               */
              if (props.isStreaming) {
                return;
              }

              props.handleSendMessage?.(event);
            }
          }}
          value={props.input}
          onChange={(event) => {
            props.handleInputChange?.(event);
          }}
          onPaste={props.handlePaste}
          style={{
            minHeight: props.TEXTAREA_MIN_HEIGHT,
            maxHeight: props.TEXTAREA_MAX_HEIGHT,
          }}
          placeholder={
            props.chatMode === 'build' ? 'Décrivez l’application à créer…' : 'De quoi voulez-vous discuter ?'
          }
          aria-label={props.chatMode === 'build' ? 'Décrivez l’application à créer' : 'Message'}
          translate="no"
        />
        <div className="flex justify-between items-center gap-2 text-sm px-3 pb-3 pt-1">
          <div className="flex gap-1 items-center min-w-0">
            <ClientOnly>
              {() => (
                <AttachmentMenu
                  onAttachFile={() => props.handleFileUpload()} // Opens image file picker (image/* only)
                  onScreenshot={() => {
                    /*
                     * Remember the attachment control before the menu closes and focus moves: the
                     * dialog returns focus there on close (see onCloseAutoFocus in ScreenshotDialog).
                     */
                    screenshotOpenerRef.current = document.querySelector<HTMLElement>(
                      '[data-testid="attachment-menu-trigger"]',
                    );
                    setIsScreenshotOpen(true);
                  }}
                  onOpenDesignDialog={() => {
                    /*
                     * Trigger the design dialog by programmatically clicking the hidden button
                     * This is a workaround since ColorSchemeDialog manages its own state
                     */
                    const designButton = document.querySelector('[title="Design Palette"]') as HTMLButtonElement;
                    designButton?.click();
                  }}
                  onEnhancePrompt={() => {
                    props.enhancePrompt?.();
                  }}
                  connectors={connectors}
                  onConnectorEnabledChange={setConnectorEnabled}
                  onOpenMcpTools={() => setIsMcpToolsOpen(true)}
                  mcpToolsInitialized={mcpToolsInitialized}
                  webSearchEnabled={mcpSettings.webSearchEnabled}
                  onWebSearchEnabledChange={setWebSearchEnabled}
                  enhancingPrompt={props.enhancingPrompt}
                  isEnhanceDisabled={props.input.length === 0 || props.enhancingPrompt}
                />
              )}
            </ClientOnly>
            <ClientOnly>{() => <ToolAccessMenu />}</ClientOnly>
            {/* Hidden components for programmatic access from menu */}
            <div className="hidden">
              <ColorSchemeDialog designScheme={props.designScheme} setDesignScheme={props.setDesignScheme} />
              <SupabaseConnection />
            </div>
            <McpTools open={isMcpToolsOpen} onOpenChange={setIsMcpToolsOpen} />
            <ScreenshotDialog
              open={isScreenshotOpen}
              onOpenChange={setIsScreenshotOpen}
              openerRef={screenshotOpenerRef}
            />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  title={props.chatMode === 'discuss' ? 'Mode Discussion' : 'Mode Agent'}
                  aria-label={props.chatMode === 'discuss' ? 'Mode : Discussion' : 'Mode : Agent'}
                  className={classNames(
                    'transition-all flex items-center gap-1 rounded-md px-1.5 py-1 text-xs',
                    props.chatMode === 'discuss'
                      ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                      : props.agentMode
                        ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                        : 'bg-bolt-elements-item-backgroundDefault text-bolt-elements-item-contentDefault hover:bg-bolt-elements-item-backgroundActive',
                  )}
                >
                  {props.chatMode === 'discuss' ? (
                    <>
                      <div className="i-ph:chats text-lg" />
                      <span className="hidden sm:inline">Discussion</span>
                    </>
                  ) : (
                    <>
                      <div className="i-ph:robot text-lg" />
                      <span className="hidden sm:inline">Agent</span>
                    </>
                  )}
                  <div className="i-ph:caret-down text-sm hidden sm:block" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className={classNames(
                    'min-w-[160px] rounded-lg p-1',
                    'bg-bolt-elements-background-depth-2',
                    'border border-bolt-elements-borderColor',
                    'shadow-lg',
                    'z-50',
                  )}
                  sideOffset={5}
                  align="start"
                >
                  <DropdownMenu.Item
                    className={classNames(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer',
                      'text-bolt-elements-textPrimary',
                      'hover:bg-bolt-elements-item-backgroundActive',
                      'focus:outline-none',
                      props.chatMode === 'build' && props.agentMode && 'bg-bolt-elements-item-backgroundAccent',
                    )}
                    onSelect={() => {
                      props.setChatMode?.('build');
                      props.setAgentMode?.(true);
                    }}
                  >
                    <div className="i-ph:robot text-lg" />
                    <div className="flex flex-col">
                      <span>Agent</span>
                      <span className="text-xs text-bolt-elements-textSecondary">Planifie et utilise des outils</span>
                    </div>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={classNames(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer',
                      'text-bolt-elements-textPrimary',
                      'hover:bg-bolt-elements-item-backgroundActive',
                      'focus:outline-none',
                      props.chatMode === 'discuss' && 'bg-bolt-elements-item-backgroundAccent',
                    )}
                    onSelect={() => {
                      props.setChatMode?.('discuss');
                      props.setAgentMode?.(false);
                    }}
                  >
                    <div className="i-ph:chats text-lg" />
                    <div className="flex flex-col">
                      <span>Discussion</span>
                      <span className="text-xs text-bolt-elements-textSecondary">Discussion sans outils</span>
                    </div>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <SpeechRecognitionButton
              isListening={props.isListening}
              onStart={props.startListening}
              onStop={props.stopListening}
              disabled={props.isStreaming}
              supported={props.speechSupported ?? true}
            />
            <IconButton
              title="Réglages du modèle"
              className={classNames('transition-all flex items-center gap-1 min-w-0', {
                'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent':
                  props.isModelSettingsCollapsed,
                'bg-bolt-elements-item-backgroundDefault text-bolt-elements-item-contentDefault':
                  !props.isModelSettingsCollapsed,
              })}
              onClick={() => props.setIsModelSettingsCollapsed(!props.isModelSettingsCollapsed)}
              disabled={!props.providerList || props.providerList.length === 0}
            >
              <div className={`i-ph:caret-${props.isModelSettingsCollapsed ? 'right' : 'down'} text-lg`} />
              {props.isModelSettingsCollapsed ? (
                <span
                  className="text-xs truncate max-w-[7.5rem] sm:max-w-[14rem] text-bolt-elements-textSecondary"
                  title={props.model}
                >
                  {props.model}
                </span>
              ) : (
                <span />
              )}
            </IconButton>
          </div>
          <ClientOnly>
            {() => (
              <SendButton
                show={props.input.length > 0 || props.isStreaming || props.uploadedFiles.length > 0}
                isStreaming={props.isStreaming}
                disabled={!props.providerList || props.providerList.length === 0}
                onClick={(event) => {
                  if (props.isStreaming) {
                    props.handleStop?.();
                    return;
                  }

                  if (props.input.length > 0 || props.uploadedFiles.length > 0) {
                    props.handleSendMessage?.(event);
                  }
                }}
              />
            )}
          </ClientOnly>
          <ExpoQrModal open={props.qrModalOpen} onClose={() => props.setQrModalOpen(false)} />
        </div>
      </div>
    </div>
  );
};
