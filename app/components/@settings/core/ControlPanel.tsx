import { useStore } from '@nanostores/react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Users } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { AvatarDropdown } from './AvatarDropdown';
import { TAB_LABELS, TAB_ICONS, DEFAULT_TAB_CONFIG, TAB_DESCRIPTIONS } from './constants';
import type { TabType, Profile } from './types';
import { ConnectorCredentialDialog } from '~/components/@settings/core/ConnectorCredentialDialog';
import { TabTile } from '~/components/@settings/shared/components/TabTile';

// Import all tab components
import AccountTab from '~/components/@settings/tabs/account/AccountTab';
import AdminKeysTab from '~/components/@settings/tabs/admin/AdminKeysTab';
import type { ConnectorCredentialRequest } from '~/components/@settings/tabs/connectors/ConnectorsTab';
import ConnectorsTab from '~/components/@settings/tabs/connectors/ConnectorsTab';
import { DataTab } from '~/components/@settings/tabs/data/DataTab';
import { EventLogsTab } from '~/components/@settings/tabs/event-logs/EventLogsTab';
import FeaturesTab from '~/components/@settings/tabs/features/FeaturesTab';
import GitHubTab from '~/components/@settings/tabs/github/GitHubTab';
import GitLabTab from '~/components/@settings/tabs/gitlab/GitLabTab';
import { IaAccessTab } from '~/components/@settings/tabs/ia/IaAccessTab';
import McpTab from '~/components/@settings/tabs/mcp/McpTab';
import NetlifyTab from '~/components/@settings/tabs/netlify/NetlifyTab';
import NotificationsTab from '~/components/@settings/tabs/notifications/NotificationsTab';
import PluginTab from '~/components/@settings/tabs/plugins/PluginTab';
import ProfileTab from '~/components/@settings/tabs/profile/ProfileTab';
import CloudProvidersTab from '~/components/@settings/tabs/providers/cloud/CloudProvidersTab';
import LocalProvidersTab from '~/components/@settings/tabs/providers/local/LocalProvidersTab';
import SettingsTab from '~/components/@settings/tabs/settings/SettingsTab';
import SupabaseTab from '~/components/@settings/tabs/supabase/SupabaseTab';
import VercelTab from '~/components/@settings/tabs/vercel/VercelTab';
import VoiceTab from '~/components/@settings/tabs/voice/VoiceTab';
import { DialogTitle } from '~/components/ui/Dialog';
import { DocumentationPanel } from '~/components/ui/DocumentationPanel';
import { fetchSession, type Session } from '~/lib/auth/session';
import { useConnectionStatus } from '~/lib/hooks/useConnectionStatus';
import { useFeatures } from '~/lib/hooks/useFeatures';
import { useNotifications } from '~/lib/hooks/useNotifications';
import { profileStore } from '~/lib/stores/profile';
import { tabConfigurationStore, resetTabConfiguration } from '~/lib/stores/settings';
import { classNames } from '~/utils/classNames';

interface ControlPanelProps {
  open: boolean;
  onClose: () => void;
  initialTab?: TabType;
}

const BETA_TABS = new Set<TabType>(['local-providers', 'mcp']);

const BetaLabel = () => (
  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-purple-500/10 dark:bg-purple-500/20">
    <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400">BETA</span>
  </div>
);

interface NavGroup {
  label: string;
  tabs: TabType[];
  adminOnly?: boolean;
  accountsLink?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  { label: 'Administration', tabs: ['admin-keys'], adminOnly: true, accountsLink: true },
  { label: 'Préférences', tabs: ['settings', 'voice'] },
  { label: 'Compte', tabs: ['account', 'profile', 'notifications'] },
  { label: 'Espace de travail', tabs: ['features', 'data', 'event-logs'] },
  { label: 'Fournisseurs IA', tabs: ['ia-access'], adminOnly: false },
  { label: 'Configuration des fournisseurs', tabs: ['cloud-providers', 'local-providers'], adminOnly: true },
  { label: 'Intégrations', tabs: ['connectors', 'mcp'] },
  { label: 'Extensions', tabs: ['plugins'] },
];

export const ControlPanel = ({ open, onClose, initialTab }: ControlPanelProps) => {
  const [activeTab, setActiveTab] = useState<TabType | null>(null);
  const [loadingTab, setLoadingTab] = useState<TabType | null>(null);
  const [isDocumentationOpen, setIsDocumentationOpen] = useState(false);
  const [hasVisitedCloudProviders, setHasVisitedCloudProviders] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(true);
  const [connectorCredential, setConnectorCredential] = useState<ConnectorCredentialRequest | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const tabButtons = useRef(new Map<TabType, HTMLButtonElement>());

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const media = window.matchMedia('(min-width: 640px)');

    const focusVisiblePane = () => {
      if (!media.matches) {
        if (mobileNavigationOpen) {
          if (contentRef.current?.contains(document.activeElement)) {
            const selectedButton = activeTab ? tabButtons.current.get(activeTab) : undefined;
            (selectedButton ?? navigationRef.current?.querySelector('button'))?.focus();
          }
        } else {
          contentRef.current?.focus();
        }
      }
    };
    focusVisiblePane();
    media.addEventListener('change', focusVisiblePane);

    return () => {
      media.removeEventListener('change', focusVisiblePane);
    };
  }, [open, mobileNavigationOpen, activeTab]);

  const tabConfiguration = useStore(tabConfigurationStore);
  const profile = useStore(profileStore) as Profile;
  const [session, setSession] = useState<Session>({ loading: true, authenticated: false, user: null });

  useEffect(() => {
    const controller = new AbortController();
    fetchSession(controller.signal).then(setSession);

    return () => controller.abort();
  }, []);

  const isAdmin = Boolean(session.user?.isAdmin);
  const { hasNewFeatures, unviewedFeatures, acknowledgeAllFeatures } = useFeatures();
  const { hasUnreadNotifications, unreadNotifications, markAllAsRead } = useNotifications();
  const { hasConnectionIssues, currentIssue, acknowledgeIssue } = useConnectionStatus();
  const baseTabConfig = useMemo(() => new Map(DEFAULT_TAB_CONFIG.map((tab) => [tab.id, tab])), []);

  const visibleTabs = useMemo(() => {
    if (!tabConfiguration?.userTabs || !Array.isArray(tabConfiguration.userTabs)) {
      console.warn('Invalid tab configuration, resetting to defaults');
      resetTabConfiguration();

      return [];
    }

    const notificationsDisabled = profile?.preferences?.notifications === false;

    return tabConfiguration.userTabs
      .filter((tab) => {
        if (!tab?.id) {
          return false;
        }

        if (tab.id === 'notifications' && notificationsDisabled) {
          return false;
        }

        if (baseTabConfig.get(tab.id)?.isAdminOnly && !isAdmin) {
          return false;
        }

        return tab.visible && tab.window === 'user';
      })
      .sort((a, b) => a.order - b.order);
  }, [tabConfiguration, profile?.preferences?.notifications, baseTabConfig, isAdmin]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bolt:settings-visibility', { detail: { open } }));

    return () => {
      window.dispatchEvent(new CustomEvent('bolt:settings-visibility', { detail: { open: false } }));
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setActiveTab(null);
      setLoadingTab(null);
      setMobileNavigationOpen(true);
    } else {
      setMobileNavigationOpen(!initialTab);

      if (initialTab && (isAdmin || !['cloud-providers', 'local-providers', 'admin-keys'].includes(initialTab))) {
        setActiveTab(initialTab);
        setLoadingTab(null);

        if (initialTab === 'cloud-providers') {
          setHasVisitedCloudProviders(true);
        }
      } else {
        setActiveTab(null);
        setMobileNavigationOpen(true);
      }
    }
  }, [open, initialTab, isAdmin]);

  const handleClose = () => {
    setActiveTab(null);
    setLoadingTab(null);
    setConnectorCredential(null);
    onClose();
  };

  const getTabComponent = (tabId: TabType) => {
    switch (tabId) {
      case 'profile':
        return <ProfileTab />;
      case 'account':
        return <AccountTab />;
      case 'settings':
        return <SettingsTab />;
      case 'notifications':
        return <NotificationsTab />;
      case 'features':
        return <FeaturesTab />;
      case 'data':
        return <DataTab />;
      case 'cloud-providers':
        return <CloudProvidersTab />;
      case 'local-providers':
        return <LocalProvidersTab />;
      case 'connectors':
        return (
          <ConnectorsTab credentialRequest={connectorCredential} onCredentialRequestChange={setConnectorCredential} />
        );
      case 'github':
        return <GitHubTab />;
      case 'gitlab':
        return <GitLabTab />;
      case 'supabase':
        return <SupabaseTab />;
      case 'vercel':
        return <VercelTab />;
      case 'netlify':
        return <NetlifyTab />;
      case 'event-logs':
        return <EventLogsTab />;
      case 'mcp':
        return <McpTab />;
      case 'voice':
        return <VoiceTab />;
      case 'plugins':
        return <PluginTab />;
      case 'admin-keys':
        return <AdminKeysTab />;
      case 'ia-access':
        return <IaAccessTab />;
      default:
        return null;
    }
  };

  const getTabUpdateStatus = (tabId: TabType): boolean => {
    switch (tabId) {
      case 'features':
        return hasNewFeatures;
      case 'notifications':
        return hasUnreadNotifications;
      case 'connectors':
      case 'github':
      case 'gitlab':
      case 'supabase':
      case 'vercel':
      case 'netlify':
        return hasConnectionIssues;
      default:
        return false;
    }
  };

  const getStatusMessage = (tabId: TabType): string => {
    switch (tabId) {
      case 'features':
        return `${unviewedFeatures.length} new feature${unviewedFeatures.length === 1 ? '' : 's'} to explore`;
      case 'notifications':
        return `${unreadNotifications.length} unread notification${unreadNotifications.length === 1 ? '' : 's'}`;
      case 'connectors':
      case 'github':
      case 'gitlab':
      case 'supabase':
      case 'vercel':
      case 'netlify':
        return currentIssue === 'disconnected'
          ? 'Connection lost'
          : currentIssue === 'high-latency'
            ? 'High latency detected'
            : 'Connection issues detected';
      default:
        return '';
    }
  };

  const handleTabClick = (tabId: TabType) => {
    setMobileNavigationOpen(false);
    setLoadingTab(tabId);
    setActiveTab(tabId);

    if (tabId === 'cloud-providers') {
      setHasVisitedCloudProviders(true);
    }

    switch (tabId) {
      case 'features':
        acknowledgeAllFeatures();
        break;
      case 'notifications':
        markAllAsRead();
        break;
      case 'connectors':
      case 'github':
      case 'gitlab':
      case 'supabase':
      case 'vercel':
      case 'netlify':
        acknowledgeIssue();
        break;
    }
    setTimeout(() => setLoadingTab(null), 500);
  };

  const navigationTabs = NAV_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((id) => id !== 'notifications' || profile?.preferences?.notifications !== false),
  })).filter((group) => (!group.adminOnly || isAdmin) && group.tabs.length > 0);

  return (
    <RadixDialog.Root open={open}>
      <RadixDialog.Portal>
        <div
          className="fixed inset-0 flex items-center justify-center z-[100] modern-scrollbar"
          data-testid="settings-overlay"
        >
          <RadixDialog.Overlay className="absolute inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200" />
          <RadixDialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={handleClose}
            onPointerDownOutside={handleClose}
            className="relative z-[101]"
          >
            <DialogTitle className="sr-only">Réglages</DialogTitle>
            <div
              className={classNames(
                'w-screen h-[100dvh] sm:w-[min(1440px,calc(100vw-2rem))] sm:h-[90vh]',
                'bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary rounded-2xl shadow-2xl',
                'border border-bolt-elements-borderColor flex flex-col overflow-hidden relative transform transition-all duration-200 ease-out',
                open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
              )}
            >
              <div className="relative z-10 flex h-full min-h-0">
                <button
                  type="button"
                  data-testid="settings-close"
                  aria-label="Fermer les réglages"
                  title="Fermer"
                  onClick={handleClose}
                  className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary transition-colors hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
                >
                  <span className="i-ph:x h-5 w-5" aria-hidden="true" />
                </button>
                <aside
                  ref={navigationRef}
                  data-testid="settings-navigation"
                  className={classNames(
                    'w-full shrink-0 flex-col border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 sm:w-[248px]',
                    mobileNavigationOpen ? 'flex' : 'hidden sm:flex',
                  )}
                >
                  <div className="shrink-0 px-3 pb-1 pt-[calc(var(--header-height)+0.25rem)] sm:pt-3">
                    <button
                      type="button"
                      data-testid="settings-back"
                      aria-label={mobileNavigationOpen ? 'Retour au projet' : 'Retour à tous les réglages'}
                      title={mobileNavigationOpen ? 'Retour au projet' : 'Retour à tous les réglages'}
                      onClick={() => (mobileNavigationOpen ? handleClose() : setMobileNavigationOpen(true))}
                      className="flex min-h-11 items-center gap-2 px-2 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive"
                    >
                      <span className="i-ph:arrow-left h-4 w-4" aria-hidden="true" /> Retour
                    </button>
                  </div>
                  <nav className="min-h-0 flex-1 overflow-y-auto modern-scrollbar px-3 py-1">
                    {navigationTabs.map((group) => (
                      <div key={group.label} className="mb-5">
                        <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">
                          {group.label}
                        </p>
                        {group.tabs.map((tabId) => {
                          const Icon = TAB_ICONS[tabId];
                          const selected = activeTab === tabId;

                          return (
                            <button
                              key={tabId}
                              ref={(button) => {
                                if (button) {
                                  tabButtons.current.set(tabId, button);
                                } else {
                                  tabButtons.current.delete(tabId);
                                }
                              }}
                              aria-current={selected ? 'page' : undefined}
                              onClick={() => handleTabClick(tabId)}
                              className={classNames(
                                'flex w-full appearance-none items-center gap-3 rounded-md border-0 px-2 py-2 text-left text-sm transition-colors',
                                selected
                                  ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                                  : 'bg-transparent text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary',
                              )}
                            >
                              <Icon className="h-4 w-4" /> {TAB_LABELS[tabId]}
                            </button>
                          );
                        })}
                        {group.accountsLink && (
                          <a
                            href="/admin/users"
                            data-testid="nav-admin-users"
                            className="flex w-full appearance-none items-center gap-3 rounded-md border-0 px-2 py-2 text-left text-sm transition-colors bg-transparent text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary"
                          >
                            <Users className="h-4 w-4" aria-hidden="true" /> Comptes
                          </a>
                        )}
                      </div>
                    ))}
                  </nav>
                  <div className="flex h-16 items-center border-t border-bolt-elements-borderColor px-3">
                    <AvatarDropdown onSelectTab={handleTabClick} onOpenDocs={() => setIsDocumentationOpen(true)} />
                  </div>
                </aside>
                <main
                  ref={contentRef}
                  tabIndex={-1}
                  aria-label="Contenu des réglages"
                  data-testid="settings-content"
                  className={classNames(
                    'min-w-0 flex-1 overflow-y-auto modern-scrollbar px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 sm:pt-10 sm:pb-6 md:px-10 md:pt-12 md:pb-8',
                    mobileNavigationOpen ? 'hidden sm:block' : 'block',
                  )}
                >
                  {activeTab && activeTab !== 'cloud-providers' ? (
                    <div className="mx-auto max-w-5xl">{getTabComponent(activeTab)}</div>
                  ) : !activeTab ? (
                    <div className="mx-auto max-w-5xl">
                      <h1 className="mb-1 text-2xl font-semibold text-bolt-elements-textPrimary">Réglages</h1>
                      <p className="mb-6 text-sm text-bolt-elements-textSecondary">
                        Gérez votre compte, vos préférences, les fournisseurs et les services connectés.
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {visibleTabs.map((tab, index) => (
                          <div
                            key={tab.id}
                            className="relative min-h-[160px]"
                            style={{
                              animationDelay: `${index * 30}ms`,
                              animation: open ? 'fadeInUp 200ms ease-out forwards' : 'none',
                            }}
                          >
                            <TabTile
                              tab={tab}
                              onClick={() => handleTabClick(tab.id as TabType)}
                              isActive={activeTab === tab.id}
                              hasUpdate={getTabUpdateStatus(tab.id)}
                              statusMessage={getStatusMessage(tab.id)}
                              description={TAB_DESCRIPTIONS[tab.id]}
                              isLoading={loadingTab === tab.id}
                              className="h-full relative"
                            />
                            {BETA_TABS.has(tab.id) && <BetaLabel />}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {hasVisitedCloudProviders && (
                    <div
                      aria-hidden={activeTab !== 'cloud-providers'}
                      className={classNames('mx-auto max-w-5xl', activeTab !== 'cloud-providers' && 'hidden')}
                    >
                      <CloudProvidersTab />
                    </div>
                  )}
                </main>
              </div>
            </div>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
      <ConnectorCredentialDialog
        request={connectorCredential}
        onClose={() => setConnectorCredential(null)}
        onActivated={(connectorId) =>
          setConnectorCredential((current) => (current?.connectorId === connectorId ? null : current))
        }
      />
      <DocumentationPanel open={isDocumentationOpen} onClose={() => setIsDocumentationOpen(false)} />
    </RadixDialog.Root>
  );
};
