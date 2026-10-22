import type { ModelInfo } from '~/lib/modules/llm/types';

export type ProviderInfo = {
  staticModels: ModelInfo[];
  name: string;
  getDynamicModels?: (
    providerName: string,
    apiKeys?: Record<string, string>,
    providerSettings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ) => Promise<ModelInfo[]>;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
  icon?: string;
};

export interface IProviderSetting {
  enabled?: boolean;
  baseUrl?: string;
  OPENAI_LIKE_API_MODELS?: string;

  /** Server-set per request (api.chat): the conversation, for provider session affinity. */
  sessionKey?: string;

  /**
   * Reasoning level the user chose for this provider: 'auto' keeps the model's agent-friendly
   * default, 'disabled' turns reasoning off, a named level (low/medium/high/max…) is passed to the
   * model. Stored with the provider settings, so it follows the account.
   */
  effort?: 'auto' | 'disabled' | 'model' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'minimal' | 'none';
}

export type IProviderConfig = ProviderInfo & {
  settings: IProviderSetting;
};
