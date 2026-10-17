import Cookies from 'js-cookie';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import {
  applyAccountPreferences,
  fetchAccountPreferences,
  fetchSecretNames,
  pushSecrets,
  saveOnboardingToAccount,
} from '~/lib/accountSettings';
import { API_KEYS_UPDATED_EVENT, type ApiKeysUpdatedDetail } from '~/lib/api/apiKeys';
import { getAll, openDatabase } from '~/lib/persistence/db';
import type { MCPConfig } from '~/lib/services/mcpService';
import { useMCPStore } from '~/lib/stores/mcp';
import { DEFAULT_AVATARS, DEFAULT_AVATAR, updateProfile } from '~/lib/stores/profile';
import { setTheme, themeStore } from '~/lib/stores/theme';
import { THEMES, type Theme } from '~/types/theme';
import { PROVIDER_LIST } from '~/utils/constants';

const COMPLETED_KEY = 'bolt_onboarding_completed';
const EMPTY_MCP_CONFIG = { mcpServers: {} };

export function FirstRunOnboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  /*
   * Re-entry guard. `saving` only disables the button after a re-render, so a
   * double click ran next() twice with the same `step`; both incremented it
   * and the wizard ran past its last screen ("Step 6 of 4", empty body).
   */
  const advancing = useRef(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(DEFAULT_AVATAR);
  const [providerName, setProviderName] = useState(PROVIDER_LIST[0]?.name ?? '');
  const [apiKey, setApiKey] = useState('');
  const [mcpText, setMcpText] = useState(JSON.stringify(EMPTY_MCP_CONFIG, null, 2));
  const [selectedTheme, setSelectedTheme] = useState<Theme>(() => themeStore.get());

  const [interfaceOptions, setInterfaceOptions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('bolt_interface_options') || '{}');
      return {
        accentIntensity: typeof saved.accentIntensity === 'number' ? saved.accentIntensity : 50,
        cornerRadius: ['sharp', 'soft', 'round'].includes(saved.cornerRadius) ? saved.cornerRadius : 'soft',
        compactMode: Boolean(saved.compactMode),
        animatedTransitions: saved.animatedTransitions !== false,
      };
    } catch {
      return { accentIntensity: 50, cornerRadius: 'soft', compactMode: false, animatedTransitions: true };
    }
  });

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  /*
   * Whether the account already holds settings. Until this settles, the wizard stays shut:
   * rendering it first and hiding it a moment later made the panel flash open on every load
   * for a user who had already finished the setup.
   */
  const [accountChecked, setAccountChecked] = useState(false);

  /** Names of the secrets the account already stores, so the wizard can report them. */
  const [storedSecrets, setStoredSecrets] = useState<string[]>([]);

  const initializeMcp = useMCPStore((store) => store.initialize);
  const updateMcpSettings = useMCPStore((store) => store.updateSettings);
  const mcpInitialized = useMCPStore((store) => store.isInitialized);
  const stepTitles = useMemo(() => ['Your profile', 'Connect an AI provider', 'MCP servers', 'Appearance'], []);

  useEffect(() => {
    let active = true;

    const checkFirstRun = async () => {
      if (localStorage.getItem(COMPLETED_KEY)) {
        return;
      }

      /*
       * Ask the account before deciding to show the wizard. localStorage is per-browser, so
       * someone who finished the setup on their desktop would otherwise be asked for every
       * field again on their phone. The local check stays first because it is free and covers
       * the common case without a round trip.
       */
      try {
        const account = await fetchAccountPreferences();

        if (!active) {
          return;
        }

        if (account?.onboardingCompleted === true) {
          // Adopt the account's answer, including the profile that goes with it.
          applyAccountPreferences(account);
          localStorage.setItem(COMPLETED_KEY, 'true');

          return;
        }
      } catch (err) {
        // An unreachable account service must not block the local check below.
        console.error('Could not read the account settings before first-run check:', err);
      }

      try {
        const storedProfile = localStorage.getItem('bolt_profile');
        const profile = storedProfile ? (JSON.parse(storedProfile) as { username?: string }) : undefined;

        /*
         * Only deliberate, user-made setup counts as "already configured".
         *
         * The app writes defaults on its own at startup, so their presence proves nothing:
         *  - `mcp_settings` is seeded by the MCP store on every run;
         *  - the `apiKeys` cookie is written by the chat on mount as `{"<provider>":""}` even when
         *    no key was ever entered (APIKeyManager syncs an empty value on mount).
         * Counting either made a fresh account look configured, so the wizard never opened.
         * A real stored key (non-empty value) or a name the user typed is the actual signal.
         */
        const hasRealApiKey = (() => {
          try {
            const keys = JSON.parse(Cookies.get('apiKeys') || '{}') as Record<string, unknown>;

            return Object.values(keys).some((value) => typeof value === 'string' && value.trim() !== '');
          } catch {
            return false;
          }
        })();

        const hasExistingSetup = Boolean(
          profile?.username || hasRealApiKey || localStorage.getItem('bolt_user_profile'),
        );

        const db = await openDatabase();
        const existingChats = db ? await getAll(db) : [];
        db?.close();

        if (!active) {
          return;
        }

        if (hasExistingSetup || existingChats.length > 0) {
          localStorage.setItem(COMPLETED_KEY, 'true');

          /*
           * Existing setup found on this browser: it is the account's first visit, so upload
           * what is here. Without this the account stays empty and the next device asks again.
           */
          void saveOnboardingToAccount();

          return;
        }

        setOpen(true);
      } catch (err) {
        console.error('Could not check first-run setup state:', err);

        if (active) {
          setOpen(true);
        }
      }
    };
    void checkFirstRun();

    return () => {
      active = false;
    };
  }, []);

  /*
   * Pre-fill from the account so a half-configured account does not start from blank. Runs
   * independently of the first-run check above: even when the wizard stays closed, the local
   * profile and appearance values should match the account's.
   */
  useEffect(() => {
    let active = true;

    void fetchAccountPreferences().then((account) => {
      if (!active) {
        return;
      }

      if (!account) {
        setAccountChecked(true);

        return;
      }

      if (typeof account.profileName === 'string' && account.profileName) {
        setName((current) => current || (account.profileName as string));
      }

      if (typeof account.profileAvatar === 'string' && account.profileAvatar) {
        setAvatar((current) => (current === DEFAULT_AVATAR ? (account.profileAvatar as string) : current));
      }

      if (typeof account.interfaceOptions === 'string') {
        try {
          const parsed = JSON.parse(account.interfaceOptions) as Partial<typeof interfaceOptions>;

          setInterfaceOptions((current) => ({
            accentIntensity:
              typeof parsed.accentIntensity === 'number' ? parsed.accentIntensity : current.accentIntensity,
            cornerRadius: ['sharp', 'soft', 'round'].includes(parsed.cornerRadius as string)
              ? (parsed.cornerRadius as typeof current.cornerRadius)
              : current.cornerRadius,
            compactMode: typeof parsed.compactMode === 'boolean' ? parsed.compactMode : current.compactMode,
            animatedTransitions:
              typeof parsed.animatedTransitions === 'boolean'
                ? parsed.animatedTransitions
                : current.animatedTransitions,
          }));
        } catch {
          // Malformed account value: keep what the browser already has.
        }
      }

      setAccountChecked(true);
    });

    return () => {
      active = false;
    };
  }, []);

  /* Report which secrets the account already holds, so the wizard can say "already set". */
  useEffect(() => {
    let active = true;

    void fetchSecretNames().then((names) => {
      if (active && names) {
        setStoredSecrets(names);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (open && !mcpInitialized) {
      void initializeMcp();
    }
  }, [open, mcpInitialized, initializeMcp]);

  const finish = () => {
    localStorage.setItem(COMPLETED_KEY, 'true');
    setOpen(false);

    /*
     * Push the whole result to the account, which is what makes the next device skip this
     * wizard entirely. The local writes above already happened (the UI must not wait on the
     * network); this call adds the account copy that a phone will read.
     */
    void saveOnboardingToAccount().then((saved) => {
      if (!saved) {
        /*
         * Not fatal — the browser is set up — but the promise "no second device re-asks"
         * is not kept, so say so rather than failing silently.
         */
        console.warn('Onboarding finished locally, but the account copy could not be saved.');
      }
    });
  };

  const saveApiKey = () => {
    const current = Cookies.get('apiKeys');

    let keys: Record<string, string> = {};

    try {
      keys = current ? (JSON.parse(current) as Record<string, string>) : {};
    } catch {
      keys = {};
    }

    if (!providerName || !apiKey.trim()) {
      return;
    }

    const apiKeys = { ...keys, [providerName]: apiKey.trim() };
    Cookies.set('apiKeys', JSON.stringify(apiKeys), { expires: 365 });
    window.dispatchEvent(
      new CustomEvent<ApiKeysUpdatedDetail>(API_KEYS_UPDATED_EVENT, { detail: { apiKeys, providerName } }),
    );

    /*
     * Also store it on the account, encrypted server-side. The cookie above is what the
     * running app reads (it keeps working offline and the server never hands a key back), so
     * this is a second home rather than a replacement: a key entered on the desktop is then
     * present when the phone signs in, instead of being asked for again.
     */
    void pushSecrets({ provider_settings: JSON.stringify(apiKeys) });
  };

  const next = async () => {
    if (advancing.current) {
      return;
    }

    advancing.current = true;

    try {
      await advance();
    } finally {
      advancing.current = false;
    }
  };

  const advance = async () => {
    setError('');

    if (step === 0 && name.trim()) {
      updateProfile({ username: name.trim(), avatar });
    } else if (step === 0) {
      updateProfile({ avatar });
    }

    if (step === 1) {
      saveApiKey();
    }

    if (step === 2) {
      try {
        const config = JSON.parse(mcpText) as MCPConfig;

        if (!config || typeof config.mcpServers !== 'object' || config.mcpServers === null) {
          throw new Error('Configuration must include an mcpServers object.');
        }

        setSaving(true);

        const currentSettings = useMCPStore.getState().settings;
        await updateMcpSettings({ ...currentSettings, mcpConfig: config });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save MCP configuration.');
        setSaving(false);

        return;
      }
      setSaving(false);
    }

    if (step === 3) {
      setTheme(selectedTheme);
      localStorage.setItem('bolt_interface_options', JSON.stringify(interfaceOptions));

      const root = document.documentElement;
      root.dataset.accentIntensity = String(interfaceOptions.accentIntensity);
      root.style.setProperty('--interface-accent-strength', `${interfaceOptions.accentIntensity}%`);
      root.dataset.cornerRadius = interfaceOptions.cornerRadius;
      root.dataset.compactMode = String(interfaceOptions.compactMode);
      root.dataset.animatedTransitions = String(interfaceOptions.animatedTransitions);
    }

    if (step >= 3) {
      finish();
    } else {
      setStep(Math.min(step + 1, stepTitles.length - 1));
    }
  };

  /*
   * Keep the wizard shut until the account has answered. Showing it and hiding it a moment
   * later made the panel flash on every page load for someone who had already finished.
   */
  if (!open || !accountChecked) {
    return null;
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
        }
      }}
    >
      <Dialog
        backdropClassName="!bg-[#09080f]/80 !backdrop-blur-md bg-[radial-gradient(ellipse_at_top,_rgba(91,33,182,0.18),_transparent_55%)]"
        className="w-[min(560px,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto !rounded-xl !border-[#302e39] !bg-[#1b1a22] p-6 !text-[#f4f1fa]"
        showCloseButton={false}
      >
        <div className="mb-5">
          <div className="mb-2 text-xs font-medium text-[#a09baa]">
            Step {step + 1} of {stepTitles.length}
          </div>
          <div className="mb-3 flex gap-1" aria-hidden="true">
            {stepTitles.map((title, index) => (
              <span
                key={title}
                className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-[#8b5cf6]' : 'bg-[#393641]'}`}
              />
            ))}
          </div>
          <DialogTitle className="text-xl font-semibold">Welcome to Bolt</DialogTitle>
          <DialogDescription className="mt-1 text-sm !text-[#a09baa]">
            Let’s get your workspace ready. Optional details can be left blank and changed later in Settings.
          </DialogDescription>
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="onboarding-name">
              What should we call you?
            </label>
            <input
              id="onboarding-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              className="w-full rounded-md border border-[#302e39] bg-[#121116] px-3 py-2 text-sm text-[#f4f1fa] outline-none focus:border-[#8b5cf6]"
            />
            <div>
              <span className="mb-2 block text-sm font-medium">Choose an avatar</span>
              <div className="flex flex-wrap items-center gap-3">
                {DEFAULT_AVATARS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={`Use ${preset.name} avatar`}
                    aria-pressed={avatar === preset.src}
                    onClick={() => setAvatar(preset.src)}
                    className={`h-14 w-14 overflow-hidden rounded-full border-2 ${avatar === preset.src ? 'border-[#8b5cf6] ring-2 ring-[#8b5cf6]/40' : 'border-[#393641]'}`}
                  >
                    <img src={preset.src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
                <label className="flex h-14 cursor-pointer items-center rounded-md border border-dashed border-[#393641] px-3 text-xs text-[#a09baa] hover:bg-[#25232d]">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];

                      if (!file) {
                        return;
                      }

                      if (!file.type.startsWith('image/')) {
                        setError('Choose an image file.');
                        return;
                      }

                      if (file.size > 2 * 1024 * 1024) {
                        setError('Choose an image smaller than 2 MB.');
                        return;
                      }

                      const reader = new FileReader();

                      reader.onload = () => {
                        if (typeof reader.result === 'string') {
                          setAvatar(reader.result);
                          setError('');
                        } else {
                          setError('Could not read that image.');
                        }
                      };
                      reader.onerror = () => setError('Could not read that image.');
                      reader.readAsDataURL(file);
                      event.target.value = '';
                    }}
                  />
                  Upload image
                </label>
                {avatar.startsWith('data:image/') && (
                  <img
                    src={avatar}
                    alt="Uploaded avatar preview"
                    className="h-14 w-14 rounded-full border border-[#393641] object-cover"
                  />
                )}
              </div>
              {error && (
                <p role="alert" className="mt-2 text-xs text-red-500">
                  {error}
                </p>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-[#a09baa]">
              Choose a provider and add its API key to start building. You can also skip this and use a locally
              configured provider.
            </p>
            {storedSecrets.includes('provider_settings') && (
              <p className="rounded-md border border-[#393641] bg-[#22212a] px-3 py-2 text-xs text-[#b8b3c2]">
                Your account already stores API keys, encrypted. You can leave this blank — they will be used
                automatically.
              </p>
            )}
            <label className="block text-sm font-medium" htmlFor="onboarding-provider">
              AI provider
            </label>
            <select
              id="onboarding-provider"
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              className="w-full rounded-md border border-[#302e39] bg-[#121116] px-3 py-2 text-sm text-[#f4f1fa]"
            >
              {PROVIDER_LIST.map((provider) => (
                <option key={provider.name} value={provider.name}>
                  {provider.name}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium" htmlFor="onboarding-api-key">
              API key
            </label>
            <input
              id="onboarding-api-key"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste your API key"
              className="w-full rounded-md border border-[#302e39] bg-[#121116] px-3 py-2 text-sm text-[#f4f1fa] outline-none focus:border-[#8b5cf6]"
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-[#a09baa]">
              Add MCP server configuration as JSON. You can leave this empty and set it up later in Settings.
            </p>
            <label className="block text-sm font-medium" htmlFor="onboarding-mcp">
              MCP configuration
            </label>
            <textarea
              id="onboarding-mcp"
              spellCheck={false}
              value={mcpText}
              onChange={(event) => setMcpText(event.target.value)}
              rows={9}
              className="w-full resize-y rounded-md border border-[#302e39] bg-[#121116] px-3 py-2 font-mono text-xs text-[#f4f1fa] outline-none focus:border-[#8b5cf6]"
            />
            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="onboarding-theme">
                Color theme
              </label>
              <select
                id="onboarding-theme"
                value={selectedTheme}
                onChange={(event) => setSelectedTheme(event.target.value as Theme)}
                className="w-full rounded-md border border-[#302e39] bg-[#121116] px-3 py-2 text-sm text-[#f4f1fa]"
              >
                {(['light', 'dark'] as const).map((mode) => (
                  <optgroup key={mode} label={`${mode[0].toUpperCase()}${mode.slice(1)} themes`}>
                    {THEMES.filter((theme) => theme.mode === mode).map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="rounded-md bg-[#22212a] p-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Accent intensity <span className="text-[#a09baa]">({interfaceOptions.accentIntensity}%)</span>
                </span>
                <input
                  aria-label="Accent intensity"
                  type="range"
                  min="0"
                  max="100"
                  value={interfaceOptions.accentIntensity}
                  onChange={(event) =>
                    setInterfaceOptions({ ...interfaceOptions, accentIntensity: Number(event.target.value) })
                  }
                  className="w-1/2 accent-[#8b5cf6]"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md bg-[#22212a] p-3">
              <span className="text-sm">Corner radius</span>
              <div className="flex gap-1" role="group" aria-label="Corner radius">
                {(['sharp', 'soft', 'round'] as const).map((radius) => (
                  <button
                    key={radius}
                    type="button"
                    aria-pressed={interfaceOptions.cornerRadius === radius}
                    onClick={() => setInterfaceOptions({ ...interfaceOptions, cornerRadius: radius })}
                    className={`appearance-none rounded-md px-2 py-1 text-xs capitalize ${interfaceOptions.cornerRadius === radius ? 'bg-[#8b5cf6] text-white' : 'bg-[#302e39] text-[#b8b3c2]'}`}
                  >
                    {radius}
                  </button>
                ))}
              </div>
            </div>

            {(
              [
                ['compactMode', 'Compact mode', 'Tighter spacing in lists'],
                ['animatedTransitions', 'Animated transitions', 'Smooth theme switching'],
              ] as const
            ).map(([key, label, description]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-[#22212a] p-3"
              >
                <span>
                  <span className="block text-sm">{label}</span>
                  <span className="text-xs text-[#a09baa]">{description}</span>
                </span>
                <input
                  type="checkbox"
                  checked={interfaceOptions[key]}
                  onChange={(event) => setInterfaceOptions({ ...interfaceOptions, [key]: event.target.checked })}
                  className="h-4 w-4 accent-[#8b5cf6]"
                />
              </label>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((current) => Math.max(current - 1, 0))}
                className="appearance-none rounded-md border border-[#393641] bg-[#302e39] px-4 py-2 text-sm text-[#eeeaf5] hover:bg-[#3b3846] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void next()}
              className="rounded-md bg-[#8b5cf6] px-4 py-2 text-sm font-medium text-white hover:bg-[#9a6bff] disabled:opacity-60"
            >
              {saving ? 'Saving…' : step === 3 ? 'Finish setup' : 'Continue'}
            </button>
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
}
