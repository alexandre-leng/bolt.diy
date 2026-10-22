import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import type { ConnectorId } from '~/lib/stores/mcp';
import { classNames } from '~/utils/classNames';

type ConnectorMenuItem = {
  id: ConnectorId;
  name: string;
  icon: ReactNode;
  enabled: boolean;
};

interface AttachmentMenuProps {
  onAttachFile: () => void;
  onScreenshot: () => void;
  connectors: ConnectorMenuItem[];
  onConnectorEnabledChange: (connector: ConnectorId, enabled: boolean) => void;
  onEnhancePrompt: () => void;
  onOpenDesignDialog: () => void;
  onOpenMcpTools: () => void;
  mcpToolsInitialized: boolean;
  webSearchEnabled: boolean;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  enhancingPrompt?: boolean;
  isEnhanceDisabled?: boolean;
}

const itemClassName = classNames(
  'flex min-h-11 items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer touch-manipulation',
  'text-bolt-elements-textPrimary outline-none transition-colors',
  'data-[highlighted]:bg-bolt-elements-background-depth-3',
  'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
);

const contentClassName = classNames(
  'min-w-[220px] max-w-[calc(100vw-1rem)] rounded-lg p-1',
  'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto',
  'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-lg z-[1000]',
);

function CheckedIndicator() {
  return (
    <span className="ml-auto flex h-5 w-5 items-center justify-center" aria-hidden="true">
      <DropdownMenu.ItemIndicator>
        <span className="i-ph:check text-lg" />
      </DropdownMenu.ItemIndicator>
    </span>
  );
}

export function AttachmentMenu({
  onAttachFile,
  onScreenshot,
  connectors,
  onConnectorEnabledChange,
  onEnhancePrompt,
  onOpenDesignDialog,
  onOpenMcpTools,
  mcpToolsInitialized,
  webSearchEnabled,
  onWebSearchEnabledChange,
  enhancingPrompt = false,
  isEnhanceDisabled = false,
}: AttachmentMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="attachment-menu-trigger"
          title="Ajouter une pièce jointe ou un outil"
          aria-label="Ajouter une pièce jointe ou un outil"
          className={classNames(
            'flex h-11 w-11 shrink-0 items-center justify-center bg-transparent rounded-md touch-manipulation',
            'text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive',
            'hover:bg-bolt-elements-item-backgroundActive transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
          )}
        >
          <div className="i-ph:plus text-xl" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content className={contentClassName} sideOffset={5} align="start">
          <DropdownMenu.Item className={itemClassName} onSelect={onAttachFile}>
            <div className="i-ph:paperclip text-lg" aria-hidden="true" />
            <span>Joindre une image</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClassName} onSelect={onScreenshot}>
            <div className="i-ph:image text-lg" aria-hidden="true" />
            <span>Créer à partir d’une image</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClassName} onSelect={onOpenDesignDialog}>
            <div className="i-ph:palette text-lg" aria-hidden="true" />
            <span>Palette de couleurs</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={itemClassName}
            onSelect={onEnhancePrompt}
            disabled={isEnhanceDisabled || enhancingPrompt}
          >
            <div
              className={
                enhancingPrompt ? 'i-svg-spinners:90-ring-with-bg text-lg animate-spin' : 'i-bolt:stars text-lg'
              }
              aria-hidden="true"
            />
            <span>{enhancingPrompt ? 'Amélioration en cours…' : 'Améliorer la consigne'}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClassName} onSelect={onOpenMcpTools} disabled={!mcpToolsInitialized}>
            <div className="i-bolt:mcp text-lg" aria-hidden="true" />
            <span>Outils MCP</span>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="h-px bg-bolt-elements-borderColor my-1" />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className={itemClassName}>
              <div className="i-ph:plug text-lg" aria-hidden="true" />
              <span>Connecteurs</span>
              <div className="i-ph:caret-right text-sm ml-auto" aria-hidden="true" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className={contentClassName} sideOffset={8}>
                <DropdownMenu.CheckboxItem
                  checked={webSearchEnabled}
                  onCheckedChange={(checked) => onWebSearchEnabledChange(checked === true)}
                  className={itemClassName}
                >
                  <div className="i-ph:magnifying-glass text-lg" aria-hidden="true" />
                  <span>Recherche web</span>
                  <CheckedIndicator />
                </DropdownMenu.CheckboxItem>
                {connectors.map((connector) => (
                  <DropdownMenu.CheckboxItem
                    key={connector.id}
                    checked={connector.enabled}
                    onCheckedChange={(checked) => onConnectorEnabledChange(connector.id, checked === true)}
                    className={itemClassName}
                  >
                    <span aria-hidden="true">{connector.icon}</span>
                    <span>{connector.name}</span>
                    <CheckedIndicator />
                  </DropdownMenu.CheckboxItem>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
