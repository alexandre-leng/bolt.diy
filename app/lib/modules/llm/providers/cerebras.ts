import { createCerebras } from '@ai-sdk/cerebras';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { CEREBRAS_CATALOG } from '~/lib/modules/llm/catalogs/cerebras.catalog';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

export default class CerebrasProvider extends BaseProvider {
  name = 'Cerebras';
  getApiKeyLink = 'https://cloud.cerebras.ai/settings';

  config = {
    apiTokenKey: 'CEREBRAS_API_KEY',
  };

  /*
   * Built from the generated models.dev catalog (catalogs/cerebras.catalog.ts), not hand-written:
   * the previous list carried stale limits and missed models. Regenerate with
   * `node scripts/generate-model-catalog.mjs --all`.
   */
  staticModels: ModelInfo[] = CEREBRAS_CATALOG
    .filter((entry) => entry.tools && entry.status !== 'deprecated')
    .map((entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'Cerebras',
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
      defaultApiTokenKey: 'CEREBRAS_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch('https://api.cerebras.ai/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(5000),
      });

      if (!response.ok) {
        console.error(`Cerebras API error: ${response.statusText}`);
        return [];
      }

      const data = (await response.json()) as any;
      const staticModelIds = this.staticModels.map((m) => m.name);

      // Filter out models we already have in staticModels
      const dynamicModels =
        data.data
          ?.filter((model: any) => !staticModelIds.includes(model.id))
          .map((m: any) => ({
            name: m.id,
            label: `${m.id} (Dynamic)`,
            provider: this.name,
            maxTokenAllowed: 32000, // Default, Cerebras typically has good context
          })) || [];

      return dynamicModels;
    } catch (error) {
      console.error(`Failed to fetch Cerebras models:`, error);
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
      defaultApiTokenKey: 'CEREBRAS_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const cerebras = createCerebras({
      apiKey,
    });

    return cerebras(model);
  }
}
