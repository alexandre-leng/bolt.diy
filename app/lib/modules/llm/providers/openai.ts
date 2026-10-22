import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { OPENAI_CATALOG } from '~/lib/modules/llm/catalogs/openai.catalog';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

function isResponsesOnlyModel(modelId: string): boolean {
  /*
   * OpenAI Codex models are Responses-API-only (not supported in /v1/chat/completions).
   * Examples: gpt-5.3-codex, gpt-5.1-codex-mini, codex-mini-latest
   */
  return modelId.includes('codex') || modelId.startsWith('codex-');
}

export default class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  getApiKeyLink = 'https://platform.openai.com/api-keys';

  config = {
    apiTokenKey: 'OPENAI_API_KEY',
  };

  /*
   * Built from the generated models.dev catalog (catalogs/openai.catalog.ts), not hand-written:
   * the previous list carried stale limits and missed models. Regenerate with
   * `node scripts/generate-model-catalog.mjs --all`.
   */
  staticModels: ModelInfo[] = OPENAI_CATALOG.filter((entry) => entry.tools && entry.status !== 'deprecated').map(
    (entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'OpenAI',
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
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`https://api.openai.com/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const res = (await response.json()) as any;
    const staticModelIds = this.staticModels.map((m) => m.name);

    const data = res.data.filter(
      (model: any) =>
        model.object === 'model' &&
        (model.id.startsWith('gpt-') ||
          model.id.startsWith('o') ||
          model.id.startsWith('chatgpt-') ||
          model.id.startsWith('codex-')) &&
        !staticModelIds.includes(model.id),
    );

    return data.map((m: any) => {
      // Get accurate context window from OpenAI API
      let contextWindow = 32000; // default fallback

      // OpenAI provides context_length in their API response
      if (m.context_length) {
        contextWindow = m.context_length;
      } else if (m.id?.includes('gpt-5.5')) {
        contextWindow = 1000000;
      } else if (m.id?.includes('gpt-5.4')) {
        contextWindow = 1000000;
      } else if (m.id?.includes('gpt-5.3-codex')) {
        contextWindow = 400000;
      } else if (m.id?.includes('gpt-4o')) {
        contextWindow = 128000; // GPT-4o has 128k context
      } else if (m.id?.includes('gpt-4-turbo') || m.id?.includes('gpt-4-1106')) {
        contextWindow = 128000; // GPT-4 Turbo has 128k context
      } else if (m.id?.includes('gpt-4')) {
        contextWindow = 8192; // Standard GPT-4 has 8k context
      } else if (m.id?.includes('gpt-3.5-turbo')) {
        contextWindow = 16385; // GPT-3.5-turbo has 16k context
      }

      // Determine completion token limits based on model type (accurate limits)
      let maxCompletionTokens = 4096; // default for most models

      if (m.id?.includes('gpt-5.5') || m.id?.includes('gpt-5.4') || m.id?.includes('gpt-5.3-codex')) {
        maxCompletionTokens = 128000;
      } else if (m.id?.startsWith('o1-preview')) {
        maxCompletionTokens = 32000; // o1-preview: 32K output limit
      } else if (m.id?.startsWith('o1-mini')) {
        maxCompletionTokens = 65000; // o1-mini: 65K output limit
      } else if (m.id?.startsWith('o1')) {
        maxCompletionTokens = 32000; // Other o1 models: 32K limit
      } else if (m.id?.includes('o3') || m.id?.includes('o4')) {
        maxCompletionTokens = 100000; // o3/o4 models: 100K output limit
      } else if (m.id?.includes('gpt-4o')) {
        maxCompletionTokens = 4096; // GPT-4o standard: 4K (64K with long output mode)
      } else if (m.id?.includes('gpt-4')) {
        maxCompletionTokens = 8192; // Standard GPT-4: 8K output limit
      } else if (m.id?.includes('gpt-3.5-turbo')) {
        maxCompletionTokens = 4096; // GPT-3.5-turbo: 4K output limit
      }

      return {
        name: m.id,
        label: `${m.id} (${Math.floor(contextWindow / 1000)}k context)`,
        provider: this.name,
        maxTokenAllowed: Math.min(contextWindow, 1000000),
        maxCompletionTokens,
      };
    });
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
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      apiKey,
    });

    if (isResponsesOnlyModel(model) && typeof (openai as any).responses === 'function') {
      return (openai as any).responses(model);
    }

    return openai.chat(model);
  }
}
