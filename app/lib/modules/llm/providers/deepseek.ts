import { createDeepSeek } from '@ai-sdk/deepseek';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { DEEPSEEK_CATALOG } from '~/lib/modules/llm/catalogs/deepseek.catalog';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

export default class DeepseekProvider extends BaseProvider {
  name = 'Deepseek';
  getApiKeyLink = 'https://platform.deepseek.com/apiKeys';

  config = {
    apiTokenKey: 'DEEPSEEK_API_KEY',
  };

  /*
   * Built from the generated models.dev catalog (catalogs/deepseek.catalog.ts), not hand-written:
   * the previous list carried stale limits and missed models. Regenerate with
   * `node scripts/generate-model-catalog.mjs --all`.
   */
  staticModels: ModelInfo[] = DEEPSEEK_CATALOG
    .filter((entry) => entry.tools && entry.status !== 'deprecated')
    .map((entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'Deepseek',
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
      defaultApiTokenKey: 'DEEPSEEK_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch('https://api.deepseek.com/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(5000),
      });

      if (!response.ok) {
        console.error(`DeepSeek API error: ${response.statusText}`);
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
            maxTokenAllowed: m.id?.startsWith('deepseek-v4') ? 1000000 : 64000,
            maxCompletionTokens: m.id?.startsWith('deepseek-v4') ? 384000 : 8192,
          })) || [];

      return dynamicModels;
    } catch (error) {
      console.error(`Failed to fetch DeepSeek models:`, error);
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
      defaultApiTokenKey: 'DEEPSEEK_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const deepseek = createDeepSeek({
      apiKey,
    });

    /*
     * v4's callable took a second settings argument and supported
     * `simulateStreaming`. Both are gone in v3: the callable is 1-arg and
     * `simulateStreaming` no longer exists in the package at all, so the
     * commented-out flag was permanently dead rather than merely disabled.
     */
    return deepseek.chat(model);
  }
}
