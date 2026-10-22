import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/*
 * Composer regressions (audit U1, U8, U13). Children with heavy dependencies are stubbed:
 * these tests are about the textarea's own handlers.
 */
vi.mock('./APIKeyManager', () => ({ APIKeyManager: () => null, getApiKeysFromCookies: () => ({}) }));
vi.mock('./AttachmentMenu', () => ({
  AttachmentMenu: ({ onScreenshot }: { onScreenshot: () => void }) => (
    <button onClick={onScreenshot}>Ouvrir image vers code</button>
  ),
}));
vi.mock('./FilePreview', () => ({ default: () => null }));
vi.mock('./MCPTools', () => ({ McpTools: () => null }));
vi.mock('./ScreenshotStateManager', () => ({ ScreenshotStateManager: () => null }));
vi.mock('./ScreenshotToCode', () => ({
  ScreenshotToCode: ({ onContinue }: { onContinue?: (code: string, path: string) => void }) => (
    <button
      onClick={() =>
        onContinue?.('<!doctype html><html><body>Pagia</body></html>', '/home/project/screenshot-generated.html')
      }
    >
      Continuer avec Bolt
    </button>
  ),
}));
vi.mock('./SendButton.client', () => ({ SendButton: () => null }));
vi.mock('./SupabaseConnection', () => ({ SupabaseConnection: () => null }));
vi.mock('./ToolAccessMenu', () => ({ ToolAccessMenu: () => null }));
vi.mock('~/components/chat/ModelSelector', () => ({ ModelSelector: () => null }));
vi.mock('~/components/ui/ColorSchemeDialog', () => ({ ColorSchemeDialog: () => null }));
vi.mock('~/components/workbench/ExpoQrModal', () => ({ ExpoQrModal: () => null }));

import { ChatBox } from './ChatBox';

function renderChatBox(overrides: Record<string, unknown> = {}) {
  const props = {
    isModelSettingsCollapsed: true,
    setIsModelSettingsCollapsed: vi.fn(),
    provider: undefined,
    providerList: [],
    modelList: [],
    apiKeys: {},
    isModelLoading: undefined,
    onApiKeysChange: vi.fn(),
    uploadedFiles: [] as File[],
    imageDataList: [] as string[],
    textareaRef: undefined,
    input: 'la suite',
    handlePaste: vi.fn(),
    TEXTAREA_MIN_HEIGHT: 76,
    TEXTAREA_MAX_HEIGHT: 200,
    isStreaming: false,
    handleSendMessage: vi.fn(),
    isListening: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    chatStarted: true,
    qrModalOpen: false,
    setQrModalOpen: vi.fn(),
    handleFileUpload: vi.fn(),
    handleStop: vi.fn(),
    setUploadedFiles: vi.fn(),
    setImageDataList: vi.fn(),
    handleInputChange: vi.fn(),
    chatMode: 'build' as const,
    ...overrides,
  };

  render(<ChatBox {...(props as any)} />);

  return { props, textarea: screen.getByRole('textbox') as HTMLTextAreaElement };
}

describe('screenshot continuation', () => {
  it('prepares an editable build prompt with the exact source without sending automatically', async () => {
    const handleInputChange = vi.fn();
    const setChatMode = vi.fn();
    const setAgentMode = vi.fn();
    const { props } = renderChatBox({ handleInputChange, setChatMode, setAgentMode });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir image vers code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer avec Bolt' }));
    expect(handleInputChange).toHaveBeenCalled();

    const draft = handleInputChange.mock.calls[0][0].target.value;
    expect(draft).toContain('/home/project/screenshot-generated.html');
    expect(draft).toContain('<!doctype html><html><body>Pagia</body></html>');
    expect(draft).toContain('la suite');
    expect(setChatMode).toHaveBeenCalledWith('build');
    expect(setAgentMode).toHaveBeenCalledWith(true);
    expect(props.handleSendMessage).not.toHaveBeenCalled();
  });
});

describe('ChatBox: Enter during a generation (U1)', () => {
  it('does not stop the running generation', () => {
    const { props, textarea } = renderChatBox({ isStreaming: true });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Before: Enter called handleStop(), aborting the build and its file/shell actions.
    expect(props.handleStop).not.toHaveBeenCalled();
    expect(props.handleSendMessage).not.toHaveBeenCalled();
  });

  it('still sends on Enter when idle', () => {
    const { props, textarea } = renderChatBox();

    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(props.handleSendMessage).toHaveBeenCalledTimes(1);
  });

  it('lets an IME composition confirm with Enter, even while streaming', () => {
    const { props, textarea } = renderChatBox({ isStreaming: true });

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });

    expect(props.handleStop).not.toHaveBeenCalled();
    expect(props.handleSendMessage).not.toHaveBeenCalled();
  });
});

describe('ChatBox: dropping several images (U8)', () => {
  it('attaches every dropped image, not only the last one read', async () => {
    const { props, textarea } = renderChatBox();
    const files = ['a.png', 'b.png', 'c.png'].map((name) => new File(['x'], name, { type: 'image/png' }));

    await act(async () => {
      fireEvent.drop(textarea, { dataTransfer: { files } });
    });

    await waitFor(() => expect(props.setUploadedFiles).toHaveBeenCalled());

    const lastFiles = props.setUploadedFiles.mock.calls.at(-1)?.[0] as File[];
    const lastImages = props.setImageDataList.mock.calls.at(-1)?.[0] as string[];

    expect(lastFiles.map((file) => file.name)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(lastImages).toHaveLength(3);
    expect(lastImages.every((url) => url.startsWith('data:image/png'))).toBe(true);
  });
});

describe('ChatBox: French chrome (U13)', () => {
  it('shows a French placeholder and mode label', () => {
    const { textarea } = renderChatBox();

    expect(textarea.placeholder).toBe('Décrivez l’application à créer…');
    expect(screen.getByRole('button', { name: 'Mode : Agent' })).toBeTruthy();
  });
});
