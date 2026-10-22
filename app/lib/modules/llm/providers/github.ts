import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { GITHUB_CATALOG } from '~/lib/modules/llm/catalogs/github.catalog';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

export default class GithubProvider extends BaseProvider {
  name = 'Github';
  getApiKeyLink = 'https://github.com/settings/personal-access-tokens';

  config = {
    apiTokenKey: 'GITHUB_API_KEY',
  };

  /*
   * GitHub Models - Available models through GitHub's native API
   * Updated for the new GitHub Models API at https://models.github.ai
   * Model IDs use the format: publisher/model-name
   */
  /*
   * Built from the generated models.dev catalog (catalogs/github.catalog.ts), not hand-written:
   * the previous list carried stale limits and missed models. Regenerate with
   * `node scripts/generate-model-catalog.mjs --all`.
   */
  staticModels: ModelInfo[] = GITHUB_CATALOG.filter((entry) => entry.tools && entry.status !== 'deprecated').map(
    (entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'Github',
      maxTokenAllowed: entry.context,
      maxCompletionTokens: entry.maxOutput,
    }),
  );

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'GITHUB_API_KEY',
    });

    if (!apiKey) {
      console.log('GitHub: No API key found. Make sure GITHUB_API_KEY is set in your .env.local file');

      // Return static models if no API key is available
      return this.staticModels;
    }

    console.log('GitHub: API key found, attempting to fetch dynamic models...');

    try {
      // Try to fetch dynamic models from GitHub API
      const response = await fetch('https://models.github.ai/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = (await response.json()) as { data?: any[] };
        console.log('GitHub: Successfully fetched models from API');

        if (data.data && Array.isArray(data.data)) {
          return data.data.map((model: any) => ({
            name: model.id,
            label: model.name || model.id.split('/').pop() || model.id,
            provider: 'Github',
            maxTokenAllowed: model.limits?.max_input_tokens || 128000,
            maxCompletionTokens: model.limits?.max_output_tokens || 16384,
          }));
        }
      } else {
        console.warn('GitHub: API request failed with status:', response.status, response.statusText);
      }
    } catch (error) {
      console.warn('GitHub: Failed to fetch models, using static models:', error);
    }

    // Fallback to static models
    console.log('GitHub: Using static models as fallback');

    return this.staticModels;
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModel {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    console.log(`GitHub: Creating model instance for ${model}`);

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'GITHUB_API_KEY',
    });

    if (!apiKey) {
      console.error('GitHub: No API key found');
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    console.log('GitHub: Using configured API key');

    const openai = createOpenAI({
      baseURL: 'https://models.github.ai/inference',
      apiKey,
    });

    console.log(`GitHub: Created OpenAI client, requesting model: ${model}`);

    return openai.chat(model);
  }
}
