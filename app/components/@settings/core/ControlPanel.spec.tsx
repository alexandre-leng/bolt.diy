import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ControlPanel } from './ControlPanel';

// Boundaries mocked: heavy tab bodies and external stores/hooks. The panel itself is real.
vi.mock('~/components/@settings/tabs/profile/ProfileTab', () => ({ default: () => <div>profile-body</div> }));
vi.mock('~/components/@settings/tabs/settings/SettingsTab', () => ({ default: () => <div>settings-body</div> }));
vi.mock('~/components/@settings/tabs/notifications/NotificationsTab', () => ({
  default: () => <div>notifications-body</div>,
}));
vi.mock('~/components/@settings/tabs/features/FeaturesTab', () => ({ default: () => <div>features-body</div> }));
vi.mock('~/components/@settings/tabs/data/DataTab', () => ({ DataTab: () => <div>data-body</div> }));
vi.mock('~/components/@settings/tabs/providers/cloud/CloudProvidersTab', () => ({
  default: () => <div>cloud-body</div>,
}));
vi.mock('~/components/@settings/tabs/providers/local/LocalProvidersTab', () => ({
  default: () => <div>local-body</div>,
}));
vi.mock('~/components/@settings/tabs/connectors/ConnectorsTab', () => ({ default: () => <div>connectors-body</div> }));
vi.mock('~/components/@settings/tabs/mcp/McpTab', () => ({ default: () => <div>mcp-body</div> }));
vi.mock('~/components/@settings/tabs/plugins/PluginTab', () => ({ default: () => <div>plugin-body</div> }));
vi.mock('~/components/@settings/tabs/event-logs/EventLogsTab', () => ({ EventLogsTab: () => <div>logs-body</div> }));

const sessionState = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('~/lib/auth/session', () => ({
  fetchSession: async () => ({
    loading: false,
    authenticated: true,
    user: { id: 'u1', email: 'someone@example.test', emailVerified: true, isAdmin: sessionState.isAdmin },
  }),
}));
vi.mock('~/components/@settings/core/AvatarDropdown', () => ({ AvatarDropdown: () => <div /> }));
vi.mock('~/components/ui/DocumentationPanel', () => ({ DocumentationPanel: () => null }));
vi.mock('~/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ hasConnectionIssues: false, currentIssue: null, acknowledgeIssue: vi.fn() }),
}));
vi.mock('~/lib/hooks/useFeatures', () => ({
  useFeatures: () => ({ hasNewFeatures: false, unviewedFeatures: [], acknowledgeAllFeatures: vi.fn() }),
}));
vi.mock('~/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({ hasUnreadNotifications: false, unreadNotifications: [], markAllAsRead: vi.fn() }),
}));
vi.mock('~/lib/stores/settings', async () => {
  const { atom } = await import('nanostores');
  return {
    tabConfigurationStore: atom({
      userTabs: [
        { id: 'profile', visible: true, window: 'user', order: 0 },
        { id: 'settings', visible: true, window: 'user', order: 1 },
      ],
    }),
    resetTabConfiguration: vi.fn(),
  };
});
vi.mock('~/lib/stores/profile', async () => {
  const { atom } = await import('nanostores');
  return { profileStore: atom({ preferences: { notifications: true } }) };
});

const setViewport = (mobile: boolean) => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) =>
      ({
        matches: !mobile && query === '(min-width: 640px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
};

/*
 * The model settings are the administrator's. These cases pin which SURFACE a normal account
 * gets, because the old arrangement was the bug: the provider screens, with their key field,
 * were one click away from every account while the panel looked "restricted".
 */
describe('control panel: model settings are administrator-only', () => {
  beforeEach(() => {
    setViewport(false);
  });

  it('shows the editable provider screens to an administrator', async () => {
    sessionState.isAdmin = true;
    render(<ControlPanel open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /fournisseurs cloud/i })).toBeInTheDocument());
  });

  it('hides the editable provider screens from a normal account, keeping the read-only view', async () => {
    sessionState.isAdmin = false;
    render(<ControlPanel open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /mon accès ia/i })).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /fournisseurs cloud/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /fournisseurs locaux/i })).toBeNull();
  });
});

describe('ControlPanel accessibility', () => {
  beforeEach(() => {
    setViewport(true);
  });

  it('keeps a dialog name on the overview', () => {
    render(<ControlPanel open onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Réglages');
  });

  it('keeps the dialog name after navigating into a sub-tab', async () => {
    render(<ControlPanel open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /profil|profile/i }));

    await waitFor(() => expect(screen.getByText('profile-body')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Réglages');
  });

  it('keeps the dialog name when opened on a deep link', () => {
    render(<ControlPanel open onClose={vi.fn()} initialTab="profile" />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Réglages');
    expect(screen.getByText('profile-body')).toBeInTheDocument();
  });

  it('moves focus into the content pane after choosing a tab on mobile', async () => {
    render(<ControlPanel open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /profil|profile/i }));

    await waitFor(() => expect(screen.getByTestId('settings-content')).toHaveFocus());
  });

  it('returns focus to the navigation when the mobile back control is used', async () => {
    render(<ControlPanel open onClose={vi.fn()} initialTab="profile" />);

    /*
     * Two panes now share one header component (sidebar column and content column), and both
     * are in the tree: the content one is the visible pane on a phone, so pick by test id.
     */
    const back = screen
      .getAllByTestId('settings-back')
      .find((element) => element.getAttribute('aria-label') === 'Retour à tous les réglages');
    expect(back).toBeTruthy();
    fireEvent.click(back as HTMLElement);

    await waitFor(() => {
      const active = document.activeElement as HTMLElement;
      expect(screen.getByTestId('settings-navigation').contains(active)).toBe(true);
    });
  });

  it('does not steal focus on desktop', async () => {
    setViewport(false);
    render(<ControlPanel open onClose={vi.fn()} />);

    const before = document.activeElement;
    fireEvent.click(screen.getByRole('button', { name: /profil|profile/i }));

    await waitFor(() => expect(screen.getByText('profile-body')).toBeInTheDocument());
    expect(screen.getByTestId('settings-content')).not.toHaveFocus();
    expect(document.activeElement).not.toBe(screen.getByTestId('settings-content'));
    void before;
  });

  it('closes from the dedicated close control', () => {
    const onClose = vi.fn();
    render(<ControlPanel open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fermer les réglages' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the mobile navigation pane, where the return link is the only other exit', () => {
    setViewport(true);

    const onClose = vi.fn();
    render(<ControlPanel open onClose={onClose} />);

    // On phones the navigation pane fills the dialog and "Retour au projet" scrolls with it.
    expect(screen.getByTestId('settings-navigation')).toBeVisible();

    fireEvent.click(screen.getByTestId('settings-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the close control reachable after opening a sub-tab', async () => {
    const onClose = vi.fn();
    render(<ControlPanel open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /profil|profile/i }));
    await waitFor(() => expect(screen.getByText('profile-body')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('settings-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
