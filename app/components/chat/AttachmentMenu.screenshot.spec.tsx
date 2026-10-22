import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AttachmentMenu } from './AttachmentMenu';

it('opens the screenshot action from the attachment menu', async () => {
  const onScreenshot = vi.fn();
  render(
    <AttachmentMenu
      onAttachFile={vi.fn()}
      onScreenshot={onScreenshot}
      connectors={[]}
      onConnectorEnabledChange={vi.fn()}
      onEnhancePrompt={vi.fn()}
      onOpenDesignDialog={vi.fn()}
      onOpenMcpTools={vi.fn()}
      mcpToolsInitialized={false}
      webSearchEnabled={false}
      onWebSearchEnabledChange={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter une pièce jointe ou un connecteur' }));
  await userEvent.click(await screen.findByText('Depuis une capture d’écran'));
  expect(onScreenshot).toHaveBeenCalledOnce();
});
