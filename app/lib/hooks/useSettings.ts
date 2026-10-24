import { useStore } from '@nanostores/react';
import Cookies from 'js-cookie';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TabWindowConfig } from '~/components/@settings/core/types';
import { getLocalStorage, setLocalStorage } from '~/lib/persistence';
import { logStore } from '~/lib/stores/logs';
import {
  isDebugMode,
  isEventLogsEnabled,
  promptStore,
  providersStore,
  serverEnabledProvidersStore,
  latestBranchStore,
  autoSelectStarterTemplate,
  enableContextOptimizationStore,
  tabConfigurationStore,
  resetTabConfiguration as resetTabConfig,
  updateProviderSettings as updateProviderSettingsStore,
  updateLatestBranch,
  updateAutoSelectTemplate,
  updateContextOptimization,
  updateEventLogs,
  updatePromptId,
  writeProvidersCookie,
} from '~/lib/stores/settings';
import type { IProviderSetting, ProviderInfo, IProviderConfig } from '~/types/model';

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  language: string;
  notifications: boolean;
  eventLogs: boolean;
  timezone: string;
  tabConfiguration: TabWindowConfig;
}

export interface UseSettingsReturn {
  // Theme and UI settings
  setTheme: (theme: Settings['theme']) => void;
  setLanguage: (language: string) => void;
  setNotifications: (enabled: boolean) => void;
  setEventLogs: (enabled: boolean) => void;
  setTimezone: (timezone: string) => void;
  settings: Settings;

  // Provider settings
  providers: Record<string, IProviderConfig>;
  activeProviders: ProviderInfo[];
  updateProviderSettings: (provider: string, config: IProviderSetting) => void;

  // Debug and development settings
  debug: boolean;
  enableDebugMode: (enabled: boolean) => void;
  eventLogs: boolean;
  promptId: string;
  setPromptId: (promptId: string) => void;
  isLatestBranch: boolean;
  enableLatestBranch: (enabled: boolean) => void;
  autoSelectTemplate: boolean;
  setAutoSelectTemplate: (enabled: boolean) => void;
  contextOptimizationEnabled: boolean;
  enableContextOptimization: (enabled: boolean) => void;

  // Tab configuration
  tabConfiguration: TabWindowConfig;
  resetTabConfiguration: () => void;
}

// Add interface to match ProviderSetting type
interface ProviderSettingWithIndex extends IProviderSetting {
  [key: string]: any;
}

export function useSettings(): UseSettingsReturn {
  const providers = useStore(providersStore);
  const debug = useStore(isDebugMode);
  const eventLogs = useStore(isEventLogsEnabled);
  const promptId = useStore(promptStore);
  const isLatestBranch = useStore(latestBranchStore);
  const autoSelectTemplate = useStore(autoSelectStarterTemplate);

  /*
   * The providers offered in the composer.
   *
   * `settings.enabled` is a PER-BROWSER preference (it lived in localStorage and a cookie), so it
   * cannot decide what the instance serves: an admin switching a provider off there only closed
   * it for their own browser. The list is therefore what the SERVER says the instance serves,
   * filtered by the local choice; when the server says nothing (an unreachable accounts service,
   * no policy) the local preference is all there is, which is the previous behaviour.
   */
  const serverEnabledProviders = useStore(serverEnabledProvidersStore);

  const activeProviders = useMemo(() => {
    const local = Object.values(providers).filter((provider) => provider.settings.enabled);

    if (serverEnabledProviders.length === 0) {
      return local;
    }

    const enabled = local.filter((provider) => serverEnabledProviders.includes(provider.name));

    /*
     * A browser that closed everything locally must not end up with an empty picker: the
     * instance's list is the floor, the local choice only removes what the server allows.
     */
    return enabled.length > 0
      ? enabled
      : Object.values(providers).filter((provider) => serverEnabledProviders.includes(provider.name));
  }, [providers, serverEnabledProviders]);

  const contextOptimizationEnabled = useStore(enableContextOptimizationStore);
  const tabConfiguration = useStore(tabConfigurationStore);

  const [settings, setSettings] = useState<Settings>(() => {
    const storedSettings = getLocalStorage('settings');
    return {
      theme: storedSettings?.theme || 'system',
      language: storedSettings?.language || 'en',
      notifications: storedSettings?.notifications ?? true,
      eventLogs: storedSettings?.eventLogs ?? true,
      timezone: storedSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      tabConfiguration,
    };
  });

  const saveSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      setLocalStorage('settings', updated);

      return updated;
    });
  }, []);

  const updateProviderSettings = useCallback((provider: string, config: ProviderSettingWithIndex) => {
    updateProviderSettingsStore(provider, config);
  }, []);

  const enableDebugMode = useCallback((enabled: boolean) => {
    isDebugMode.set(enabled);
    logStore.logSystem(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    Cookies.set('isDebugEnabled', String(enabled));
  }, []);

  const setEventLogs = useCallback((enabled: boolean) => {
    updateEventLogs(enabled);
    logStore.logSystem(`Event logs ${enabled ? 'enabled' : 'disabled'}`);
  }, []);

  const setPromptId = useCallback((id: string) => {
    updatePromptId(id);
    logStore.logSystem(`Prompt template updated to ${id}`);
  }, []);

  const enableLatestBranch = useCallback((enabled: boolean) => {
    updateLatestBranch(enabled);
    logStore.logSystem(`Main branch updates ${enabled ? 'enabled' : 'disabled'}`);
  }, []);

  const setAutoSelectTemplate = useCallback((enabled: boolean) => {
    updateAutoSelectTemplate(enabled);
    logStore.logSystem(`Auto select template ${enabled ? 'enabled' : 'disabled'}`);
  }, []);

  const enableContextOptimization = useCallback((enabled: boolean) => {
    updateContextOptimization(enabled);
    logStore.logSystem(`Context optimization ${enabled ? 'enabled' : 'disabled'}`);
  }, []);

  const setTheme = useCallback(
    (theme: Settings['theme']) => {
      saveSettings({ theme });
    },
    [saveSettings],
  );

  const setLanguage = useCallback(
    (language: string) => {
      saveSettings({ language });
    },
    [saveSettings],
  );

  const setNotifications = useCallback(
    (enabled: boolean) => {
      saveSettings({ notifications: enabled });
    },
    [saveSettings],
  );

  const setTimezone = useCallback(
    (timezone: string) => {
      saveSettings({ timezone });
    },
    [saveSettings],
  );

  /*
   * Single writer for the `providers` cookie: the store's updateProviderSettings already writes it
   * synchronously, so this effect only re-syncs a store populated from elsewhere (localStorage at
   * boot, or the server's auto-enable pass). Keeping one implementation avoids the two drifting.
   */
  useEffect(() => {
    writeProvidersCookie(providersStore.get());
  }, [providers]);

  /*
   * Ask the server which providers the instance serves, once per page load. The answer is the
   * admin's switchboard; a failure leaves the store empty, i.e. "no rule known", and the local
   * preference keeps driving the composer as before.
   */
  useEffect(() => {
    let cancelled = false;

    fetch('/api/configured-providers', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) {
          return undefined;
        }

        return (await response.json()) as { enabledProviders?: unknown };
      })
      .then((payload) => {
        if (!cancelled && Array.isArray(payload?.enabledProviders)) {
          serverEnabledProvidersStore.set(payload.enabledProviders.filter((name) => typeof name === 'string'));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ...settings,
    providers,
    activeProviders,
    updateProviderSettings,
    debug,
    enableDebugMode,
    eventLogs,
    setEventLogs,
    promptId,
    setPromptId,
    isLatestBranch,
    enableLatestBranch,
    autoSelectTemplate,
    setAutoSelectTemplate,
    contextOptimizationEnabled,
    enableContextOptimization,
    setTheme,
    setLanguage,
    setNotifications,
    setTimezone,
    settings,
    tabConfiguration,
    resetTabConfiguration: resetTabConfig,
  };
}
