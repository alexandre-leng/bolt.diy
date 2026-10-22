import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AttachmentMenu } from './AttachmentMenu';

function props() {
  return {
    onAttachFile: vi.fn(),
    onScreenshot: vi.fn(),
    connectors: [],
    onConnectorEnabledChange: vi.fn(),
    onEnhancePrompt: vi.fn(),
    onOpenDesignDialog: vi.fn(),
    onOpenMcpTools: vi.fn(),
    mcpToolsInitialized: false,
    webSearchEnabled: false,
    onWebSearchEnabledChange: vi.fn(),
  };
}

it('opens the screenshot action from the named attachment menu', async () => {
  const callbacks = props();
  render(<AttachmentMenu {...callbacks} />);
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter une pièce jointe ou un outil' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Créer à partir d’une image' }));
  expect(callbacks.onScreenshot).toHaveBeenCalledOnce();
});

it('exposes web search state and lets keyboard users change it', async () => {
  const user = userEvent.setup();
  const callbacks = props();
  render(<AttachmentMenu {...callbacks} />);
  await user.click(screen.getByRole('button', { name: 'Ajouter une pièce jointe ou un outil' }));

  const submenu = screen.getByRole('menuitem', { name: 'Connecteurs' });
  submenu.focus();
  await user.keyboard('{ArrowRight}');

  const search = await screen.findByRole('menuitemcheckbox', { name: 'Recherche web' });
  expect(search.getAttribute('aria-checked')).toBe('false');
  search.focus();
  await user.keyboard('{Enter}');
  expect(callbacks.onWebSearchEnabledChange).toHaveBeenCalledWith(true);
});

it('announces connector checked state instead of relying on red and green dots', async () => {
  const user = userEvent.setup();
  const callbacks = props();
  render(<AttachmentMenu {...callbacks} connectors={[{ id: 'github', name: 'GitHub', enabled: true, icon: null }]} />);
  await user.click(screen.getByRole('button', { name: 'Ajouter une pièce jointe ou un outil' }));
  screen.getByRole('menuitem', { name: 'Connecteurs' }).focus();
  await user.keyboard('{ArrowRight}');

  const connector = await screen.findByRole('menuitemcheckbox', { name: 'GitHub' });
  expect(connector.getAttribute('aria-checked')).toBe('true');
  await user.click(connector);
  expect(callbacks.onConnectorEnabledChange).toHaveBeenCalledWith('github', false);
});

it('prevents repeated prompt enhancement while an enhancement is pending', async () => {
  const callbacks = props();
  render(<AttachmentMenu {...callbacks} enhancingPrompt />);
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter une pièce jointe ou un outil' }));

  const action = screen.getByRole('menuitem', { name: 'Amélioration en cours…' });
  expect(action.getAttribute('aria-disabled')).toBe('true');
  await userEvent.click(action);
  expect(callbacks.onEnhancePrompt).not.toHaveBeenCalled();
});
