import type { LoaderFunction } from 'react-router';

import { resolveProviderKeys } from '~/lib/.server/api/instance-keys';
import { LLMManager } from '~/lib/modules/llm/manager';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';

interface ConfiguredProvider {
  name: string;
  isConfigured: boolean;
  configMethod: 'environment' | 'none';

  /** Key set by an administrator for the whole instance: the user cannot change it. */
  managed?: boolean;

  /** Whether a user may also supply their own key for this provider. */
  userKeyAllowed?: boolean;
}

/**
 * API endpoint that detects which providers are configured via environment variables
 * This helps auto-enable providers that have been set up by the user
 */
export const loader: LoaderFunction = async ({ context, request }) => {
  try {
    const llmManager = LLMManager.getInstance(context?.cloudflare?.env as any);
    const configuredProviders: ConfiguredProvider[] = [];

    /*
     * A provider the administrator configured for the whole instance counts as configured,
     * even with no environment variable. Before this, the screens driven by this endpoint
     * treated a managed provider as unavailable and asked the user for a key.
     */
    const resolved = await resolveProviderKeys({
      env: context?.cloudflare?.env as unknown as Record<string, unknown>,
      userId: request?.headers?.get('X-Bolt-User-Id'),
    });

    /*
     * Check each registered provider, not only the local ones: the composer reads this map to
     * decide whether to show "clé API requise", so a provider the admin configured counted as
     * missing a key for every remote provider, which made a working instance look unset.
     */
    const names = new Set<string>([...LOCAL_PROVIDERS]);

    for (const provider of llmManager.getAllProviders()) {
      names.add(provider.name);
    }

    for (const name of resolved.policy.allowedProviders) {
      names.add(name);
    }

    for (const providerName of names) {
      const providerInstance = llmManager.getProvider(providerName);

      let isConfigured = false;
      let configMethod: 'environment' | 'none' = 'none';

      if (providerInstance) {
        const config = providerInstance.config;

        /*
         * Check if required environment variables are set
         * For providers with baseUrlKey (Ollama, LMStudio, OpenAILike)
         */
        if (config.baseUrlKey) {
          const baseUrlEnvVar = config.baseUrlKey;
          const cloudflareEnv = (context?.cloudflare?.env as Record<string, any>)?.[baseUrlEnvVar];
          const processEnv = process.env[baseUrlEnvVar];
          const managerEnv = llmManager.env[baseUrlEnvVar];

          const envBaseUrl = cloudflareEnv || processEnv || managerEnv;

          /*
           * Only consider configured if environment variable is explicitly set
           * Don't count default config.baseUrl values or placeholder values
           */
          const isValidEnvValue =
            envBaseUrl &&
            typeof envBaseUrl === 'string' &&
            envBaseUrl.trim().length > 0 &&
            !envBaseUrl.includes('your_') && // Filter out placeholder values like "your_openai_like_base_url_here"
            !envBaseUrl.includes('_here') &&
            envBaseUrl.startsWith('http'); // Must be a valid URL

          if (isValidEnvValue) {
            isConfigured = true;
            configMethod = 'environment';
          }
        }

        // For providers that might need API keys as well (check this separately, not as fallback)
        if (config.apiTokenKey && !isConfigured) {
          const apiTokenEnvVar = config.apiTokenKey;

          const envApiToken =
            (context?.cloudflare?.env as Record<string, any>)?.[apiTokenEnvVar] ||
            process.env[apiTokenEnvVar] ||
            llmManager.env[apiTokenEnvVar];

          // Only consider configured if API key is set and not a placeholder
          const isValidApiToken =
            envApiToken &&
            typeof envApiToken === 'string' &&
            envApiToken.trim().length > 0 &&
            !envApiToken.includes('your_') && // Filter out placeholder values
            !envApiToken.includes('_here') &&
            envApiToken.length > 10; // API keys are typically longer than 10 chars

          if (isValidApiToken) {
            isConfigured = true;
            configMethod = 'environment';
          }
        }
      }

      if (!isConfigured && resolved.apiKeys[providerName]) {
        isConfigured = true;
        configMethod = 'environment';
      }

      configuredProviders.push({
        name: providerName,
        isConfigured,
        configMethod,
        managed: resolved.source[providerName] === 'instance',
        userKeyAllowed: resolved.allowUserKeys.includes(providerName),
      });
    }

    return Response.json({
      providers: configuredProviders,
    });
  } catch (error) {
    console.error('Error detecting configured providers:', error);

    // Return default state on error
    return Response.json({
      providers: LOCAL_PROVIDERS.map((name) => ({
        name,
        isConfigured: false,
        configMethod: 'none' as const,
      })),
    });
  }
};
