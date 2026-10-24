import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConnectorsTab from './ConnectorsTab';

/*
 * The Connectors tab used to own the "Enable <x>" dialog. `Dialog` paints its backdrop and its
 * content as two siblings at z-[9999], and nested here the backdrop had no dialog above it: the
 * dismiss layer was never mounted, so Escape did nothing and later clicks landed on a phantom
 * full-screen layer. The tab now only reports the request and renders no dialog of its own.
 *
 * It also printed a muted grey "Configure" button on six cards, i.e. the only action looked
 * disabled, and the card texts were half English in an otherwise French panel.
 */
vi.mock('~/lib/stores/mcp', () => {
  const state = {
    settings: { connectorEnabled: {} },
    isInitialized: true,
    initialize: vi.fn(),
    setConnectorEnabled: vi.fn(),
  };

  const useMCPStore = <T,>(selector: (value: typeof state) => T): T => selector(state);

  return { useMCPStore };
});

vi.mock('~/lib/services/connectorActivation', () => ({
  activateConnector: vi.fn(),
}));

// The per-connector panels are large and irrelevant here.
vi.mock('~/components/@settings/tabs/github/GitHubTab', () => ({ default: () => <div>github-panel</div> }));
vi.mock('~/components/@settings/tabs/gitlab/GitLabTab', () => ({ default: () => <div>gitlab-panel</div> }));
vi.mock('~/components/@settings/tabs/netlify/NetlifyTab', () => ({ default: () => <div>netlify-panel</div> }));
vi.mock('~/components/@settings/tabs/vercel/VercelTab', () => ({ default: () => <div>vercel-panel</div> }));
vi.mock('~/components/@settings/tabs/supabase/SupabaseTab', () => ({ default: () => <div>supabase-panel</div> }));
vi.mock('~/components/@settings/tabs/connectors/BrowserUseCloudTab', () => ({
  default: () => <div>browser-panel</div>,
}));

describe('ConnectorsTab', () => {
  it('renders no dialog of its own while a key is required', () => {
    const onCredentialRequestChange = vi.fn();

    const { container } = render(
      <ConnectorsTab
        credentialRequest={{ connectorId: 'github', initialError: 'No valid API key is configured.' }}
        onCredentialRequestChange={onCredentialRequestChange}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.z-\\[9999\\]')).toBeNull();
  });

  it('paints the Configure action with the primary ink, not a muted grey', () => {
    render(<ConnectorsTab credentialRequest={null} onCredentialRequestChange={vi.fn()} />);

    const configure = screen.getByTestId('connector-configure-github');
    expect(configure.textContent).toContain('Configurer');
    expect(configure.className).toContain('text-bolt-elements-textPrimary');
    expect(configure.className).not.toContain('text-bolt-elements-textSecondary');
  });

  it('speaks French on the cards and their switch labels', () => {
    render(<ConnectorsTab credentialRequest={null} onCredentialRequestChange={vi.fn()} />);

    // The group heading uses the same words as the pill, so several nodes carry it: at least one.
    expect(screen.getAllByText('Contrôle de version').length).toBeGreaterThan(0);

    // Radix's switch renders role="switch" once mounted; the accessible name is the action.
    expect(screen.getByRole('switch', { name: 'Activer GitHub' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Connect your GitHub account');
    expect(document.body.textContent).not.toContain('Turn on GitHub');
  });

  it('opens a connector panel from its Configure button', () => {
    render(<ConnectorsTab credentialRequest={null} onCredentialRequestChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('connector-configure-gitlab'));

    expect(screen.getByText('gitlab-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retour aux outils connectés/ })).toBeTruthy();
  });
});
