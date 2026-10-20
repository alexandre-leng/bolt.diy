import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ModelEffort } from '~/lib/modules/llm/providers/opencode-go';
import { opencodeGoCanDisableThinking, opencodeGoEfforts } from '~/lib/modules/llm/providers/opencode-go';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import type { ProviderInfo } from '~/types/model';
import { classNames } from '~/utils/classNames';

// Fuzzy search utilities
const levenshteinDistance = (str1: string, str2: string): number => {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }

  return matrix[str2.length][str1.length];
};

const fuzzyMatch = (query: string, text: string): { score: number; matches: boolean } => {
  if (!query) {
    return { score: 0, matches: true };
  }

  if (!text) {
    return { score: 0, matches: false };
  }

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Exact substring match gets highest score
  if (textLower.includes(queryLower)) {
    return { score: 100 - (textLower.indexOf(queryLower) / textLower.length) * 20, matches: true };
  }

  // Fuzzy match with reasonable threshold
  const distance = levenshteinDistance(queryLower, textLower);
  const maxLen = Math.max(queryLower.length, textLower.length);
  const similarity = 1 - distance / maxLen;

  return {
    score: similarity > 0.6 ? similarity * 80 : 0,
    matches: similarity > 0.6,
  };
};

const highlightText = (text: string, query: string): string => {
  if (!query) {
    return text;
  }

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

  return text.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800 text-current">$1</mark>');
};

const formatContextSize = (tokens: number): string => {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }

  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}K`;
  }

  return tokens.toString();
};

interface ModelSelectorProps {
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  modelList: ModelInfo[];
  providerList: ProviderInfo[];
  apiKeys: Record<string, string>;
  modelLoading?: string;
}

// Helper function to determine if a model is likely free
const isModelLikelyFree = (model: ModelInfo, providerName?: string): boolean => {
  if (providerName === 'OpenRouter') {
    return model.isFree ?? (model.name.endsWith(':free') || model.name === 'openrouter/free');
  }

  // Models with "free" in the name or label
  if (model.name.toLowerCase().includes('free') || model.label.toLowerCase().includes('free')) {
    return true;
  }

  return false;
};

/**
 * Reasoning levels offered for the selected model, and the handler that stores the choice.
 *
 * The levels come from the generated catalog: a provider whose models publish none keeps the
 * control hidden, and "Désactivée" is not offered for a model that refuses it (a 400 otherwise).
 */
const REASONING_LABELS: Record<string, string> = {
  low: 'Faible',
  minimal: 'Minimale',
  medium: 'Moyenne',
  high: 'Élevée',
  xhigh: 'Très élevée',
  max: 'Maximale',
  none: 'Aucune',
};

export const ModelSelector = ({
  model,
  setModel,
  provider,
  setProvider,
  modelList,
  providerList,
  apiKeys,
  modelLoading,
}: ModelSelectorProps) => {
  const { providers: providerSettings, updateProviderSettings } = useSettings();

  /*
   * Reasoning levels per model.
   *
   * The local catalog only knows the models of THIS build: a provider whose levels live on the
   * server publishes nothing here, so the row stayed hidden while the model itself did answer with
   * levels. The server resolves the provider key (an env key is never sent to the client) and it is
   * the only party that can fetch /models, so its answer is asked on demand and cached per model.
   */
  const [publishedEfforts, setPublishedEfforts] = useState<Record<string, string[]>>({});
  const [publishedCanDisable, setPublishedCanDisable] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!provider?.name || !model || publishedEfforts[model] !== undefined) {
      return;
    }

    let cancelled = false;

    const parameters = new URLSearchParams({ model, provider: provider.name });

    if (apiKeys[provider.name]) {
      parameters.set('hasKey', 'true');
    }

    fetch(`/api/models/reasoning?${parameters.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        const data = (payload ?? null) as { efforts?: string[]; canDisable?: boolean } | null;

        if (cancelled || !data) {
          return;
        }

        setPublishedEfforts((current) => ({ ...current, [model]: Array.isArray(data.efforts) ? data.efforts : [] }));

        setPublishedCanDisable((current) => ({
          ...current,
          [model]: data.canDisable !== false,
        }));
      })
      .catch(() => {
        // The row stays as the local catalog describes it.
      });

    return () => {
      cancelled = true;
    };
  }, [provider?.name, model, apiKeys, publishedEfforts]);

  const effortsFor = (name: string): string[] => {
    const published = publishedEfforts[name];

    return published && published.length > 0 ? published : opencodeGoEfforts(name);
  };

  const canDisableFor = (name: string): boolean =>
    publishedEfforts[name] !== undefined ? publishedCanDisable[name] !== false : opencodeGoCanDisableThinking(name);

  const effortForModel = (name?: string): { choices: { value: string; label: string }[]; current: ModelEffort } => {
    const levels = name ? effortsFor(name) : [];
    const choices = [{ value: 'auto', label: 'Réflexion : automatique' }];

    if (levels.length > 0) {
      if (name && canDisableFor(name)) {
        choices.push({ value: 'disabled', label: 'Réflexion : désactivée' });
      }

      choices.push({ value: 'model', label: 'Réflexion : décidée par le modèle' });

      for (const level of levels) {
        choices.push({ value: level, label: `Réflexion : ${REASONING_LABELS[level] ?? level}` });
      }
    }

    const stored = provider?.name
      ? (providerSettings?.[provider.name]?.settings?.effort as ModelEffort | undefined)
      : undefined;

    return { choices, current: stored ?? 'auto' };
  };

  const { choices: effortChoices, current: effort } = effortForModel(model);

  /*
   * Keep the selected model inside what the server says is available. `model` starts as the build
   * default (or a cookie naming a model the key cannot reach), the picker then renders "Select
   * model" because the value belongs to no entry, and the effort row silently disappears with it.
   */
  useEffect(() => {
    if (modelList.length === 0 || !provider?.name) {
      return;
    }

    const available = modelList.filter((entry) => entry.provider === provider.name);

    if (available.length === 0 || available.some((entry) => entry.name === model)) {
      return;
    }

    const fallback = available.find((entry) => isModelLikelyFree(entry, provider.name)) ?? available[0];
    setModel?.(fallback.name);
  }, [modelList, provider?.name, model, setModel]);

  const changeEffort = (value: ModelEffort) => {
    if (!provider?.name) {
      return;
    }

    updateProviderSettings(provider.name, {
      ...(providerSettings?.[provider.name]?.settings ?? {}),
      effort: value === 'auto' ? undefined : value,
    });
  };

  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [debouncedModelSearchQuery, setDebouncedModelSearchQuery] = useState('');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [focusedModelIndex, setFocusedModelIndex] = useState(-1);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const modelOptionsRef = useRef<(HTMLDivElement | null)[]>([]);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  /*
   * Needed to hand keyboard focus back to the trigger when a listbox closes. Without these the focus
   * falls to `document.body` and a keyboard user loses their place.
   */
  const modelTriggerRef = useRef<HTMLDivElement>(null);
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [debouncedProviderSearchQuery, setDebouncedProviderSearchQuery] = useState('');
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [focusedProviderIndex, setFocusedProviderIndex] = useState(-1);
  const providerSearchInputRef = useRef<HTMLInputElement>(null);
  const providerOptionsRef = useRef<(HTMLDivElement | null)[]>([]);
  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const providerTriggerRef = useRef<HTMLDivElement>(null);
  const [showFreeModelsOnly, setShowFreeModelsOnly] = useState(false);

  type ConnectionStatus = 'unknown' | 'connected' | 'disconnected';

  const [localProviderStatus, setLocalProviderStatus] = useState<Record<string, ConnectionStatus>>({});

  // Check connectivity of local providers when provider list changes
  useEffect(() => {
    const checkLocalProviders = async () => {
      const statuses: Record<string, 'connected' | 'disconnected'> = {};

      for (const p of providerList) {
        if (!LOCAL_PROVIDERS.includes(p.name)) {
          continue;
        }

        // If the provider has models loaded, it's connected
        const hasModels = modelList.some((m) => m.provider === p.name);

        statuses[p.name] = hasModels ? 'connected' : 'disconnected';
      }

      setLocalProviderStatus(statuses);
    };

    checkLocalProviders();
  }, [providerList, modelList]);

  // Debounce search queries
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedModelSearchQuery(modelSearchQuery);
    }, 150);

    return () => clearTimeout(timer);
  }, [modelSearchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedProviderSearchQuery(providerSearchQuery);
    }, 150);

    return () => clearTimeout(timer);
  }, [providerSearchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
        setModelSearchQuery('');
      }

      if (providerDropdownRef.current && !providerDropdownRef.current.contains(event.target as Node)) {
        setIsProviderDropdownOpen(false);
        setProviderSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredModels = useMemo(() => {
    const baseModels = [...modelList].filter((e) => e.provider === provider?.name && e.name);

    return baseModels
      .filter((model) => {
        // Apply free models filter
        if (showFreeModelsOnly && !isModelLikelyFree(model, provider?.name)) {
          return false;
        }

        return true;
      })
      .map((model) => {
        // Calculate search scores for fuzzy matching
        const labelMatch = fuzzyMatch(debouncedModelSearchQuery, model.label);
        const nameMatch = fuzzyMatch(debouncedModelSearchQuery, model.name);
        const contextMatch = fuzzyMatch(debouncedModelSearchQuery, formatContextSize(model.maxTokenAllowed));

        const bestScore = Math.max(labelMatch.score, nameMatch.score, contextMatch.score);
        const matches = labelMatch.matches || nameMatch.matches || contextMatch.matches || !debouncedModelSearchQuery; // Show all if no query

        return {
          ...model,
          searchScore: bestScore,
          searchMatches: matches,
          highlightedLabel: highlightText(model.label, debouncedModelSearchQuery),
          highlightedName: highlightText(model.name, debouncedModelSearchQuery),
        };
      })
      .filter((model) => model.searchMatches)
      .sort((a, b) => {
        // Sort by search score (highest first), then by label
        if (debouncedModelSearchQuery) {
          return b.searchScore - a.searchScore;
        }

        return a.label.localeCompare(b.label);
      });
  }, [modelList, provider?.name, showFreeModelsOnly, debouncedModelSearchQuery]);

  const filteredProviders = useMemo(() => {
    if (!debouncedProviderSearchQuery) {
      return providerList;
    }

    return providerList
      .map((provider) => {
        const match = fuzzyMatch(debouncedProviderSearchQuery, provider.name);
        return {
          ...provider,
          searchScore: match.score,
          searchMatches: match.matches,
          highlightedName: highlightText(provider.name, debouncedProviderSearchQuery),
        };
      })
      .filter((provider) => provider.searchMatches)
      .sort((a, b) => b.searchScore - a.searchScore);
  }, [providerList, debouncedProviderSearchQuery]);

  // Reset free models filter when provider changes
  useEffect(() => {
    setShowFreeModelsOnly(false);
  }, [provider?.name]);

  useEffect(() => {
    setFocusedModelIndex(-1);
  }, [debouncedModelSearchQuery, isModelDropdownOpen, showFreeModelsOnly]);

  useEffect(() => {
    setFocusedProviderIndex(-1);
  }, [debouncedProviderSearchQuery, isProviderDropdownOpen]);

  // Clear search functions
  const clearModelSearch = useCallback(() => {
    setModelSearchQuery('');
    setDebouncedModelSearchQuery('');

    if (modelSearchInputRef.current) {
      modelSearchInputRef.current.focus();
    }
  }, []);

  const clearProviderSearch = useCallback(() => {
    setProviderSearchQuery('');
    setDebouncedProviderSearchQuery('');

    if (providerSearchInputRef.current) {
      providerSearchInputRef.current.focus();
    }
  }, []);

  /*
   * Returns keyboard focus to the combobox trigger once a listbox closes (selection or Escape).
   *
   * Without it the focus falls back to `document.body` and a keyboard user loses their place, having
   * to tab through the whole page to reach the control they were just using. Both listboxes own the
   * behaviour, so both have their helper.
   */
  const restoreModelFocus = useCallback(() => {
    modelTriggerRef.current?.focus();
  }, []);

  const restoreProviderFocus = useCallback(() => {
    providerTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isModelDropdownOpen && modelSearchInputRef.current) {
      modelSearchInputRef.current.focus();
    }
  }, [isModelDropdownOpen]);

  useEffect(() => {
    if (isProviderDropdownOpen && providerSearchInputRef.current) {
      providerSearchInputRef.current.focus();
    }
  }, [isProviderDropdownOpen]);

  const handleModelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isModelDropdownOpen) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedModelIndex((prev) => (prev + 1 >= filteredModels.length ? 0 : prev + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedModelIndex((prev) => (prev - 1 < 0 ? filteredModels.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();

        if (focusedModelIndex >= 0 && focusedModelIndex < filteredModels.length) {
          const selectedModel = filteredModels[focusedModelIndex];
          setModel?.(selectedModel.name);
          setIsModelDropdownOpen(false);
          setModelSearchQuery('');
          setDebouncedModelSearchQuery('');
          restoreModelFocus();
        }

        break;
      case 'Escape':
        e.preventDefault();
        setIsModelDropdownOpen(false);
        setModelSearchQuery('');
        setDebouncedModelSearchQuery('');
        restoreModelFocus();
        break;
      case 'Tab':
        if (!e.shiftKey && focusedModelIndex === filteredModels.length - 1) {
          setIsModelDropdownOpen(false);
        }

        break;
      case 'k':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          clearModelSearch();
        }

        break;
    }
  };

  const handleProviderKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isProviderDropdownOpen) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedProviderIndex((prev) => (prev + 1 >= filteredProviders.length ? 0 : prev + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedProviderIndex((prev) => (prev - 1 < 0 ? filteredProviders.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();

        if (focusedProviderIndex >= 0 && focusedProviderIndex < filteredProviders.length) {
          const selectedProvider = filteredProviders[focusedProviderIndex];

          if (setProvider) {
            setProvider(selectedProvider);

            const firstModel = modelList.find((m) => m.provider === selectedProvider.name);

            if (firstModel && setModel) {
              setModel(firstModel.name);
            }
          }

          setIsProviderDropdownOpen(false);
          setProviderSearchQuery('');
          setDebouncedProviderSearchQuery('');
          restoreProviderFocus();
        }

        break;
      case 'Escape':
        e.preventDefault();
        setIsProviderDropdownOpen(false);
        setProviderSearchQuery('');
        setDebouncedProviderSearchQuery('');
        restoreProviderFocus();
        break;
      case 'Tab':
        if (!e.shiftKey && focusedProviderIndex === filteredProviders.length - 1) {
          setIsProviderDropdownOpen(false);
        }

        break;
      case 'k':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          clearProviderSearch();
        }

        break;
    }
  };

  /*
   * Keep the focused option in view as the user arrows through the list.
   *
   * `scrollIntoView` is called defensively: jsdom and older engines do not implement it on every
   * node, and an exception thrown here aborts the whole effect pass, which silently broke the
   * `aria-activedescendant` navigation this hook exists to support.
   */
  useEffect(() => {
    const option = focusedModelIndex >= 0 ? modelOptionsRef.current[focusedModelIndex] : null;

    option?.scrollIntoView?.({ block: 'nearest' });
  }, [focusedModelIndex]);

  useEffect(() => {
    const option = focusedProviderIndex >= 0 ? providerOptionsRef.current[focusedProviderIndex] : null;

    option?.scrollIntoView?.({ block: 'nearest' });
  }, [focusedProviderIndex]);

  useEffect(() => {
    if (providerList.length === 0) {
      return;
    }

    if (provider && !providerList.some((p) => p.name === provider.name)) {
      const firstEnabledProvider = providerList[0];
      setProvider?.(firstEnabledProvider);

      const firstModel = modelList.find((m) => m.provider === firstEnabledProvider.name);

      if (firstModel) {
        setModel?.(firstModel.name);
      }
    }
  }, [providerList, provider, setProvider, modelList, setModel]);

  if (providerList.length === 0) {
    return (
      <div className="mb-2 p-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary">
        <p className="text-center">
          No providers are currently enabled. Please enable at least one provider in the settings to start using the
          chat.
        </p>
      </div>
    );
  }

  /*
   * `flex-wrap` so the three fields (provider, model, reasoning) each keep their own line on a
   * narrow chat pane: without it the reasoning label was cut down to a single letter.
   */
  return (
    <div className="flex gap-2 flex-wrap flex-col sm:flex-row">
      {/* Provider Combobox */}
      <div className="relative flex w-full" onKeyDown={handleProviderKeyDown} ref={providerDropdownRef}>
        <div
          ref={providerTriggerRef}
          className={classNames(
            'w-full p-2 rounded-lg border border-bolt-elements-borderColor',
            'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary',
            'focus-within:outline-none focus-within:ring-2 focus-within:ring-bolt-elements-focus',
            'transition-all cursor-pointer',
            isProviderDropdownOpen ? 'ring-2 ring-bolt-elements-focus' : undefined,
          )}
          onClick={() => setIsProviderDropdownOpen(!isProviderDropdownOpen)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsProviderDropdownOpen(!isProviderDropdownOpen);
            }
          }}
          role="combobox"
          aria-label="Fournisseur"
          aria-expanded={isProviderDropdownOpen}

          /*
           * Only point at the listbox while it exists. A closed combobox referencing a listbox that
           * is not in the DOM is an invalid reference, and the accessibility contract asserts the
           * attribute is absent when closed.
           */
          aria-controls={isProviderDropdownOpen ? 'provider-listbox' : undefined}
          aria-activedescendant={
            isProviderDropdownOpen && focusedProviderIndex >= 0 && filteredProviders[focusedProviderIndex]
              ? `provider-option-${focusedProviderIndex}`
              : undefined
          }
          aria-haspopup="listbox"
          tabIndex={0}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 truncate">
              {provider?.name && LOCAL_PROVIDERS.includes(provider.name) && (
                <span
                  className={classNames(
                    'inline-block w-2 h-2 rounded-full flex-shrink-0',
                    localProviderStatus[provider.name] === 'connected'
                      ? 'bg-green-500'
                      : localProviderStatus[provider.name] === 'disconnected'
                        ? 'bg-red-400'
                        : 'bg-bolt-elements-textTertiary',
                  )}
                  title={
                    localProviderStatus[provider.name] === 'connected'
                      ? `${provider.name} is running`
                      : localProviderStatus[provider.name] === 'disconnected'
                        ? `${provider.name} is not reachable`
                        : 'Checking...'
                  }
                />
              )}
              {provider?.name || 'Select provider'}
            </div>
            <div
              className={classNames(
                'i-ph:caret-down w-4 h-4 text-bolt-elements-textSecondary opacity-75',
                isProviderDropdownOpen ? 'rotate-180' : undefined,
              )}
            />
          </div>
        </div>

        {isProviderDropdownOpen && (
          <div
            className="absolute z-20 w-full mt-1 py-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-lg"
            role="listbox"
            id="provider-listbox"
          >
            <div className="px-2 pb-2">
              <div className="relative">
                <input
                  ref={providerSearchInputRef}
                  type="text"
                  value={providerSearchQuery}
                  onChange={(e) => setProviderSearchQuery(e.target.value)}
                  placeholder="Search providers... (⌘K to clear)"
                  className={classNames(
                    'w-full pl-8 pr-8 py-1.5 rounded-md text-sm',
                    'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                    'focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus',
                    'transition-all',
                  )}
                  onClick={(e) => e.stopPropagation()}
                  role="searchbox"
                  aria-label="Search providers"
                />
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                  <span className="i-ph:magnifying-glass text-bolt-elements-textTertiary" />
                </div>
                {providerSearchQuery && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearProviderSearch();
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-bolt-elements-background-depth-3 transition-colors"
                    aria-label="Clear search"
                  >
                    <span className="i-ph:x text-bolt-elements-textTertiary text-xs" />
                  </button>
                )}
              </div>
            </div>

            <div
              className={classNames(
                'max-h-60 overflow-y-auto',
                'sm:scrollbar-none',
                '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2',
                '[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor',
                '[&::-webkit-scrollbar-thumb]:hover:bg-bolt-elements-borderColorHover',
                '[&::-webkit-scrollbar-thumb]:rounded-full',
                '[&::-webkit-scrollbar-track]:bg-bolt-elements-background-depth-2',
                '[&::-webkit-scrollbar-track]:rounded-full',
                'sm:[&::-webkit-scrollbar]:w-1.5 sm:[&::-webkit-scrollbar]:h-1.5',
                'sm:hover:[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor/50',
                'sm:hover:[&::-webkit-scrollbar-thumb:hover]:bg-bolt-elements-borderColor',
                'sm:[&::-webkit-scrollbar-track]:bg-transparent',
              )}
            >
              {filteredProviders.length === 0 ? (
                <div className="px-3 py-3 text-sm">
                  <div className="text-bolt-elements-textTertiary mb-1">
                    {debouncedProviderSearchQuery
                      ? `No providers match "${debouncedProviderSearchQuery}"`
                      : 'No providers found'}
                  </div>
                  {debouncedProviderSearchQuery && (
                    <div className="text-xs text-bolt-elements-textTertiary">
                      Try searching for provider names like "OpenAI", "Anthropic", or "Google"
                    </div>
                  )}
                </div>
              ) : (
                filteredProviders.map((providerOption, index) => (
                  <div
                    ref={(el) => {
                      providerOptionsRef.current[index] = el;
                    }}
                    key={providerOption.name}
                    role="option"
                    aria-label={providerOption.name}
                    id={`provider-option-${index}`}
                    aria-selected={provider?.name === providerOption.name}
                    className={classNames(
                      'px-3 py-2 text-sm cursor-pointer',
                      'hover:bg-bolt-elements-background-depth-3',
                      'text-bolt-elements-textPrimary',
                      'outline-none',
                      provider?.name === providerOption.name || focusedProviderIndex === index
                        ? 'bg-bolt-elements-background-depth-3'
                        : undefined,
                      focusedProviderIndex === index ? 'ring-1 ring-inset ring-bolt-elements-focus' : undefined,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();

                      if (setProvider) {
                        setProvider(providerOption);

                        const firstModel = modelList.find((m) => m.provider === providerOption.name);

                        if (firstModel && setModel) {
                          setModel(firstModel.name);
                        }
                      }

                      setIsProviderDropdownOpen(false);
                      setProviderSearchQuery('');
                      setDebouncedProviderSearchQuery('');
                      restoreProviderFocus();
                    }}
                    tabIndex={focusedProviderIndex === index ? 0 : -1}
                  >
                    <div className="flex items-center gap-2">
                      {/*
                       * Every provider the app can drive is listed, so the ones that still need a
                       * key say so instead of looking ready. A provider with a server key is
                       * marked by /api/configured-providers (localProviderStatus); the rest are
                       * only usable once a key is entered, which this marks for the remote ones.
                       */}
                      {!LOCAL_PROVIDERS.includes(providerOption.name) &&
                        !apiKeys[providerOption.name] &&
                        localProviderStatus[providerOption.name] !== 'connected' && (
                          <span
                            className="i-ph:key text-bolt-elements-textTertiary text-xs flex-shrink-0"
                            title={`${providerOption.name} : clé API requise`}
                          />
                        )}
                      {LOCAL_PROVIDERS.includes(providerOption.name) && (
                        <span
                          className={classNames(
                            'inline-block w-2 h-2 rounded-full flex-shrink-0',
                            localProviderStatus[providerOption.name] === 'connected'
                              ? 'bg-green-500'
                              : localProviderStatus[providerOption.name] === 'disconnected'
                                ? 'bg-red-400'
                                : 'bg-bolt-elements-textTertiary',
                          )}
                        />
                      )}
                      <span
                        dangerouslySetInnerHTML={{
                          __html: (providerOption as any).highlightedName || providerOption.name,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Model Combobox */}
      <div className="relative flex w-full min-w-[70%]" onKeyDown={handleModelKeyDown} ref={modelDropdownRef}>
        <div
          ref={modelTriggerRef}
          className={classNames(
            'w-full p-2 rounded-lg border border-bolt-elements-borderColor',
            'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary',
            'focus-within:outline-none focus-within:ring-2 focus-within:ring-bolt-elements-focus',
            'transition-all cursor-pointer',
            isModelDropdownOpen ? 'ring-2 ring-bolt-elements-focus' : undefined,
          )}
          onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsModelDropdownOpen(!isModelDropdownOpen);
            }
          }}
          role="combobox"
          aria-label="Modèle"
          aria-expanded={isModelDropdownOpen}
          aria-controls={isModelDropdownOpen ? 'model-listbox' : undefined}
          aria-activedescendant={
            isModelDropdownOpen && focusedModelIndex >= 0 && filteredModels[focusedModelIndex]
              ? `model-option-${focusedModelIndex}`
              : undefined
          }
          aria-haspopup="listbox"
          tabIndex={0}
        >
          <div className="flex items-center justify-between">
            <div className="truncate">{modelList.find((m) => m.name === model)?.label || 'Select model'}</div>
            <div
              className={classNames(
                'i-ph:caret-down w-4 h-4 text-bolt-elements-textSecondary opacity-75',
                isModelDropdownOpen ? 'rotate-180' : undefined,
              )}
            />
          </div>
        </div>

        {isModelDropdownOpen && (
          <div
            className="absolute z-10 w-full mt-1 py-1 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-lg"
            role="listbox"
            id="model-listbox"
          >
            <div className="px-2 pb-2 space-y-2">
              {/* Free Models Filter Toggle - Only show for OpenRouter */}
              {provider?.name === 'OpenRouter' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFreeModelsOnly(!showFreeModelsOnly);
                    }}
                    aria-pressed={showFreeModelsOnly}
                    className={classNames(
                      'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all',
                      'hover:bg-bolt-elements-background-depth-3',
                      showFreeModelsOnly
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary border border-bolt-elements-borderColor',
                    )}
                  >
                    <span className="i-ph:gift text-xs" />
                    Free models only
                  </button>
                  {showFreeModelsOnly && (
                    <span className="text-xs text-bolt-elements-textTertiary">
                      {filteredModels.length} free model{filteredModels.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}

              {/* Search Result Count */}
              {debouncedModelSearchQuery && filteredModels.length > 0 && (
                <div className="text-xs text-bolt-elements-textTertiary px-1">
                  {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''} found
                  {filteredModels.length > 5 && ' (showing best matches)'}
                </div>
              )}

              {/* Search Input */}
              <div className="relative">
                <input
                  ref={modelSearchInputRef}
                  type="text"
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                  placeholder="Search models... (⌘K to clear)"
                  className={classNames(
                    'w-full pl-8 pr-8 py-1.5 rounded-md text-sm',
                    'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                    'focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus',
                    'transition-all',
                  )}
                  onClick={(e) => e.stopPropagation()}
                  role="searchbox"
                  aria-label="Search models"
                />
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                  <span className="i-ph:magnifying-glass text-bolt-elements-textTertiary" />
                </div>
                {modelSearchQuery && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearModelSearch();
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-bolt-elements-background-depth-3 transition-colors"
                    aria-label="Clear search"
                  >
                    <span className="i-ph:x text-bolt-elements-textTertiary text-xs" />
                  </button>
                )}
              </div>
            </div>

            <div
              className={classNames(
                'max-h-60 overflow-y-auto',
                'sm:scrollbar-none',
                '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2',
                '[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor',
                '[&::-webkit-scrollbar-thumb]:hover:bg-bolt-elements-borderColorHover',
                '[&::-webkit-scrollbar-thumb]:rounded-full',
                '[&::-webkit-scrollbar-track]:bg-bolt-elements-background-depth-2',
                '[&::-webkit-scrollbar-track]:rounded-full',
                'sm:[&::-webkit-scrollbar]:w-1.5 sm:[&::-webkit-scrollbar]:h-1.5',
                'sm:hover:[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor/50',
                'sm:hover:[&::-webkit-scrollbar-thumb:hover]:bg-bolt-elements-borderColor',
                'sm:[&::-webkit-scrollbar-track]:bg-transparent',
              )}
            >
              {modelLoading === 'all' || modelLoading === provider?.name ? (
                <div className="px-3 py-3 text-sm">
                  <div className="flex items-center gap-2 text-bolt-elements-textTertiary">
                    <span className="i-ph:spinner animate-spin" />
                    Loading models...
                  </div>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="px-3 py-3 text-sm">
                  <div className="text-bolt-elements-textTertiary mb-1">
                    {debouncedModelSearchQuery
                      ? `No models match "${debouncedModelSearchQuery}"${showFreeModelsOnly ? ' (free only)' : ''}`
                      : showFreeModelsOnly
                        ? 'No free models available'
                        : provider?.name && LOCAL_PROVIDERS.includes(provider.name)
                          ? `No models found — is ${provider.name} running?`
                          : 'No models available'}
                  </div>
                  {!debouncedModelSearchQuery && provider?.name && LOCAL_PROVIDERS.includes(provider.name) && (
                    <div className="text-xs text-bolt-elements-textTertiary mt-1">
                      Make sure {provider.name} is running and has at least one model loaded.
                      {provider.name === 'Ollama' && ' Try: ollama pull llama3.2'}
                      {provider.name === 'LMStudio' && ' Load a model in LM Studio first.'}
                    </div>
                  )}
                  {debouncedModelSearchQuery && (
                    <div className="text-xs text-bolt-elements-textTertiary">
                      Try searching for model names, context sizes (e.g., "128k", "1M"), or capabilities
                    </div>
                  )}
                  {showFreeModelsOnly && !debouncedModelSearchQuery && (
                    <div className="text-xs text-bolt-elements-textTertiary">
                      Try disabling the "Free models only" filter to see all available models
                    </div>
                  )}
                </div>
              ) : (
                filteredModels.map((modelOption, index) => (
                  <div
                    ref={(el) => {
                      modelOptionsRef.current[index] = el;
                    }}
                    key={modelOption.name}
                    role="option"
                    aria-label={modelOption.label}

                    /*
                     * The id is what `aria-activedescendant` on the trigger points at. Without it the
                     * reference resolves to nothing and a screen reader announces no active option
                     * while the user arrows through the list.
                     */
                    id={`model-option-${index}`}
                    aria-selected={model === modelOption.name}
                    className={classNames(
                      'px-3 py-2 text-sm cursor-pointer',
                      'hover:bg-bolt-elements-background-depth-3',
                      'text-bolt-elements-textPrimary',
                      'outline-none',
                      model === modelOption.name || focusedModelIndex === index
                        ? 'bg-bolt-elements-background-depth-3'
                        : undefined,
                      focusedModelIndex === index ? 'ring-1 ring-inset ring-bolt-elements-focus' : undefined,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setModel?.(modelOption.name);
                      setIsModelDropdownOpen(false);
                      setModelSearchQuery('');
                      setDebouncedModelSearchQuery('');
                      restoreModelFocus();
                    }}
                    tabIndex={focusedModelIndex === index ? 0 : -1}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          <span
                            dangerouslySetInnerHTML={{
                              __html: (modelOption as any).highlightedLabel || modelOption.label,
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-bolt-elements-textTertiary">
                            {formatContextSize(modelOption.maxTokenAllowed)} tokens
                          </span>
                          {debouncedModelSearchQuery && (modelOption as any).searchScore > 70 && (
                            <span className="text-xs text-green-500 font-medium">
                              {(modelOption as any).searchScore.toFixed(0)}% match
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {isModelLikelyFree(modelOption, provider?.name) && (
                          <span className="i-ph:gift text-xs text-purple-400" title="Free model" />
                        )}
                        {model === modelOption.name && (
                          <span className="i-ph:check text-xs text-green-500" title="Selected" />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/*
       * Reasoning level, next to the model it applies to. The choices come from the generated
       * catalog of the selected model, so a level the model refuses is never offered; providers
       * whose models publish no levels keep the control hidden.
       */}
      {(effortChoices.length > 1 || effortsFor(model ?? '').length > 0) && (
        <div className="relative flex w-full min-w-[70%] sm:min-w-[60%]">
          <label className="w-full">
            <span className="sr-only">Niveau de réflexion</span>
            {/*
             * Styled to match the two comboboxes above it. A bare <select> rendered 37px tall at
             * 14px with the browser's own arrow, next to 42px/16px Phosphor-chevron controls
             * (measured on the live host). `appearance: none` removes the native arrow so the same
             * chevron can be drawn, and the padding/height/type now match the neighbours.
             */}
            <div className="relative w-full">
              <select
                aria-label="Niveau de réflexion"
                value={effort}
                onChange={(event) => changeEffort(event.target.value as ModelEffort)}
                className={classNames(
                  'w-full p-2 pr-8 rounded-lg border border-bolt-elements-borderColor',
                  'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary',
                  'focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus',
                  'transition-all cursor-pointer text-base leading-6',
                  'appearance-none truncate',
                )}
              >
                {effortChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                <div
                  className="i-ph:caret-down w-4 h-4 text-bolt-elements-textSecondary opacity-75"
                  aria-hidden="true"
                />
              </div>
            </div>
          </label>
        </div>
      )}
    </div>
  );
};
