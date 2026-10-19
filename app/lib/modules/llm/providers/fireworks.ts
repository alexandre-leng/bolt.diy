import { createFireworks } from '@ai-sdk/fireworks';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { FIREWORKS_CATALOG } from '~/lib/modules/llm/catalogs/fireworks.catalog';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

export default class FireworksProvider extends BaseProvider {
  name = 'Fireworks';
  getApiKeyLink = 'https://fireworks.ai/api-keys';

  config = {
    apiTokenKey: 'FIREWORKS_API_KEY',
  };

  /*
   * Built from the generated models.dev catalog (catalogs/fireworks.catalog.ts), not hand-written:
   * the previous list carried stale limits and missed models. Regenerate with
   * `node scripts/generate-model-catalog.mjs --all`.
   */
  staticModels: ModelInfo[] = FIREWORKS_CATALOG
    .filter((entry) => entry.tools && entry.status !== 'deprecated')
    .map((entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'Fireworks',
      maxTokenAllowed: entry.context,
      maxCompletionTokens: entry.maxOutput,
    }));

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
      defaultApiTokenKey: 'FIREWORKS_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    try {
      // Try the accounts/fireworks/models endpoint which lists public models
      const response = await fetch('https://api.fireworks.ai/v1/accounts/fireworks/models?page_size=100', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(5000),
      });

      if (!response.ok) {
        console.error(`Fireworks API error: ${response.statusText}`);
        return [];
      }

      const data = (await response.json()) as any;
      const staticModelIds = this.staticModels.map((m) => m.name);

      // Filter out models we already have in staticModels
      const dynamicModels =
        data.data
          ?.filter((model: any) => {
            const modelPath = `accounts/fireworks/models/${model.id}`;
            return !staticModelIds.includes(modelPath) && !staticModelIds.includes(model.id);
          })
          .map((m: any) => ({
            name: `accounts/fireworks/models/${m.id}`,
            label: `${m.id} (Dynamic)`,
            provider: this.name,
            maxTokenAllowed: m.context_length || 128000,
          })) || [];

      return dynamicModels;
    } catch (error) {
      console.error(`Failed to fetch Fireworks models:`, error);
      return [];
    }
  }

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
      defaultApiTokenKey: 'FIREWORKS_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const fireworks = createFireworks({
      apiKey,
    });

    return fireworks(model);
  }
}
