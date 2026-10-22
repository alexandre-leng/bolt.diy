import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { PERPLEXITY_CATALOG } from '~/lib/modules/llm/catalogs/perplexity.catalog';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

export default class PerplexityProvider extends BaseProvider {
  name = 'Perplexity';
  getApiKeyLink = 'https://www.perplexity.ai/settings/api';

  config = {
    apiTokenKey: 'PERPLEXITY_API_KEY',
  };

  /*
   * Built from the generated models.dev catalog (catalogs/perplexity.catalog.ts), not hand-written:
   * the previous list carried stale limits and missed models. Regenerate with
   * `node scripts/generate-model-catalog.mjs --all`.
   */
  staticModels: ModelInfo[] = PERPLEXITY_CATALOG.filter((entry) => entry.tools && entry.status !== 'deprecated').map(
    (entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'Perplexity',
      maxTokenAllowed: entry.context,
      maxCompletionTokens: entry.maxOutput,
    }),
  );

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModel {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'PERPLEXITY_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const perplexity = createOpenAI({
      baseURL: 'https://api.perplexity.ai/',
      apiKey,
    });

    return perplexity.chat(model);
  }
}
