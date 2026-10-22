import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { HUGGINGFACE_CATALOG } from '~/lib/modules/llm/catalogs/huggingface.catalog';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

export default class HuggingFaceProvider extends BaseProvider {
  name = 'HuggingFace';
  getApiKeyLink = 'https://huggingface.co/settings/tokens';

  config = {
    apiTokenKey: 'HuggingFace_API_KEY',
  };

  /*
   * Built from the generated models.dev catalog (catalogs/huggingface.catalog.ts), not hand-written:
   * the previous list carried stale limits and missed models. Regenerate with
   * `node scripts/generate-model-catalog.mjs --all`.
   */
  staticModels: ModelInfo[] = HUGGINGFACE_CATALOG.filter((entry) => entry.tools && entry.status !== 'deprecated').map(
    (entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'HuggingFace',
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
      defaultApiTokenKey: 'HuggingFace_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      baseURL: 'https://api-inference.huggingface.co/v1/',
      apiKey,
    });

    return openai.chat(model);
  }
}
