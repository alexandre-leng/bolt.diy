import Cookies from 'js-cookie';
import React, { useState, useEffect, useCallback } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { fetchSession } from '~/lib/auth/session';
import type { ProviderInfo } from '~/types/model';

interface APIKeyManagerProps {
  provider: ProviderInfo;
  apiKey: string;
  setApiKey: (key: string) => void;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
}

interface KeyStatus {
  isSet: boolean;

  /** The key is set by an administrator for the whole instance: the user cannot change it. */
  managed?: boolean;

  /** Whether this user may still supply their own key for this provider. */
  userKeyAllowed?: boolean;
}

// cache which stores whether the provider's API key is set, and by whom
const providerEnvKeyStatusCache: Record<string, KeyStatus> = {};

const apiKeyMemoizeCache: { [k: string]: Record<string, string> } = {};

export function getApiKeysFromCookies() {
  const storedApiKeys = Cookies.get('apiKeys');

  let parsedKeys: Record<string, string> = {};

  if (storedApiKeys) {
    parsedKeys = apiKeyMemoizeCache[storedApiKeys];

    if (!parsedKeys) {
      parsedKeys = apiKeyMemoizeCache[storedApiKeys] = JSON.parse(storedApiKeys);
    }
  }

  return parsedKeys;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const APIKeyManager: React.FC<APIKeyManagerProps> = ({ provider, apiKey, setApiKey }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);

  /*
   * true / false = answer from /api/check-env-key; null = not known yet.
   * Starting at `false` flashed a red "Not Set" on every load until the
   * request returned, and a failed request (401 after the Basic Auth session
   * expired, network error) was reported as a missing key.
   */
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(() => providerEnvKeyStatusCache[provider.name] ?? null);

  /*
   * Only an administrator may touch a provider key. The key of this deployment is set by the
   * operator for the whole instance (env or the admin panel), so offering every account a pencil
   * and a "Get API Key" link invited people to paste a key the server ignores, or to create an
   * account on a provider they will never pay for. `null` = not known yet: show nothing rather
   * than flash a control that then disappears.
   */
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchSession(controller.signal)
      .then((session) => setIsAdmin(Boolean(session.authenticated && session.user?.isAdmin)))
      .catch(() => setIsAdmin(false));

    return () => controller.abort();
  }, []);

  const isEnvKeySet = keyStatus ? keyStatus.isSet : null;
  const managed = Boolean(keyStatus?.managed);

  // A managed key is displayed, not editable, unless the admin explicitly allowed a personal one.
  const canEdit = isAdmin === true && (!managed || Boolean(keyStatus?.userKeyAllowed));

  // Reset states and load saved key when provider changes
  useEffect(() => {
    // Load saved API key from cookies for this provider
    const savedKeys = getApiKeysFromCookies();
    const savedKey = savedKeys[provider.name] || '';

    setTempKey(savedKey);
    setApiKey(savedKey);
    setIsEditing(false);
  }, [provider.name]);

  const checkEnvApiKey = useCallback(async () => {
    // Check cache first
    if (providerEnvKeyStatusCache[provider.name] !== undefined) {
      setKeyStatus(providerEnvKeyStatusCache[provider.name]);
      return;
    }

    setKeyStatus(null);

    try {
      const response = await fetch(`/api/check-env-key?provider=${encodeURIComponent(provider.name)}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const isSet = (data as { isSet: boolean }).isSet;

      const status: KeyStatus = {
        isSet,
        managed: Boolean((data as KeyStatus).managed),
        userKeyAllowed: Boolean((data as KeyStatus).userKeyAllowed),
      };

      // Cache the result
      providerEnvKeyStatusCache[provider.name] = status;
      setKeyStatus(status);
    } catch (error) {
      // Unknown, not "missing": do not cache, do not claim the key is absent.
      console.error('Failed to check environment API key:', error);
      setKeyStatus(null);
    }
  }, [provider.name]);

  useEffect(() => {
    checkEnvApiKey();
  }, [checkEnvApiKey]);

  const handleSave = () => {
    // Save to parent state
    setApiKey(tempKey);

    // Save to cookies
    const currentKeys = getApiKeysFromCookies();
    const newKeys = { ...currentKeys, [provider.name]: tempKey };
    Cookies.set('apiKeys', JSON.stringify(newKeys));

    setIsEditing(false);
  };

  return (
    <div className="flex items-center justify-between py-3 px-1">
      <div className="flex items-center gap-2 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-bolt-elements-textSecondary">{provider?.name} API Key:</span>
          {!isEditing && (
            <div className="flex items-center gap-2">
              {apiKey ? (
                <>
                  <div className="i-ph:check-circle-fill text-green-500 w-4 h-4" />
                  <span className="text-xs text-green-500">Set via UI</span>
                </>
              ) : managed ? (
                <>
                  <div className="i-ph:shield-check-fill text-green-500 w-4 h-4" />
                  <span className="text-xs text-green-500" data-testid="api-key-managed">
                    {canEdit
                      ? 'Managed by the administrator (your own key overrides it)'
                      : 'Managed by the administrator'}
                  </span>
                </>
              ) : isEnvKeySet ? (
                <>
                  <div className="i-ph:check-circle-fill text-green-500 w-4 h-4" />
                  <span className="text-xs text-green-500">Set via environment variable</span>
                </>
              ) : isEnvKeySet === null ? (
                <span className="text-xs text-bolt-elements-textTertiary" data-testid="api-key-status-checking">
                  Checking…
                </span>
              ) : (
                <>
                  <div className="i-ph:x-circle-fill text-red-500 w-4 h-4" />
                  <span className="text-xs text-red-500">Not Set (Please set via UI or ENV_VAR)</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={tempKey}
              placeholder="Enter API Key"
              onChange={(e) => setTempKey(e.target.value)}
              className="w-[300px] px-3 py-1.5 text-sm rounded border border-bolt-elements-borderColor 
                        bg-bolt-elements-prompt-background text-bolt-elements-textPrimary 
                        focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
            <IconButton
              onClick={handleSave}
              title="Save API Key"
              className="bg-green-500/10 hover:bg-green-500/20 text-green-500"
            >
              <div className="i-ph:check w-4 h-4" />
            </IconButton>
            <IconButton
              onClick={() => setIsEditing(false)}
              title="Cancel"
              className="bg-red-500/10 hover:bg-red-500/20 text-red-500"
            >
              <div className="i-ph:x w-4 h-4" />
            </IconButton>
          </div>
        ) : (
          <>
            {/*
              A provider key is editable only by an administrator. If it is managed, personal keys
              must also have been explicitly allowed.
            */}
            {canEdit && (
              <IconButton
                onClick={() => setIsEditing(true)}
                title="Edit API Key"
                className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-500"
              >
                <div className="i-ph:pencil-simple w-4 h-4" />
              </IconButton>
            )}
            {isAdmin === true && provider?.getApiKeyLink && !apiKey && (
              <IconButton
                onClick={() => window.open(provider?.getApiKeyLink)}
                title="Get API Key"
                className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 flex items-center gap-2"
              >
                <span className="text-xs whitespace-nowrap">{provider?.labelForGetApiKey || 'Get API Key'}</span>
                <div className={`${provider?.icon || 'i-ph:key'} w-4 h-4`} />
              </IconButton>
            )}
          </>
        )}
      </div>
    </div>
  );
};
