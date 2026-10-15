import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

/*
 * OpenCode Go — https://opencode.ai/zen/go/v1
 *
 * OpenAI-compatible, with three provider-specific requirements documented at
 * https://opencode.ai/docs/go/#where-can-i-use-it:
 *  1. `x-opencode-session` is MANDATORY — without it the gateway answers 400
 *     MissingSessionID and nothing streams.
 *  2. The session must be stable per conversation, so OpenCode can pin the
 *     work to one backend and keep the prompt cache warm.
 *  3. The client must identify itself with its own User-Agent rather than a
 *     generic SDK name.
 */

const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

/** Identifies this app to OpenCode Go, as its docs require of every client. */
const OPENCODE_GO_USER_AGENT = 'bolt-diy/1.0';

/**
 * Build the routing scope sent as `x-opencode-session`.
 * Opaque + non-secret: no key material, no personal data, no random UUID
 * (a fresh value per call would defeat the affinity it exists to provide).
 * Derived from the model so it stays stable across every turn of a chat.
 */
function sessionScope(model: string): string {
  const slug = (model || 'default').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  return `bolt-diy-${slug}`;
}

export default class OpenCodeGoProvider extends BaseProvider {
  name = 'OpenCodeGo';
  getApiKeyLink = 'https://opencode.ai/auth';

  config = {
    baseUrlKey: 'OPENCODE_GO_API_BASE_URL',
    apiTokenKey: 'OPENCODE_GO_API_KEY',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'deepseek-v4.1-flash',
      label: 'DeepSeek V4.1 Flash',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'kimi-k3',
      label: 'Kimi K3',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'minimax-m3',
      label: 'MiniMax M3',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'qwen3.8-max',
      label: 'Qwen3.8 Max',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'qwen3.8-flash',
      label: 'Qwen3.8 Flash',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'glm-5.3',
      label: 'GLM 5.3',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'glm-5.3-flash',
      label: 'GLM 5.3 Flash',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'grok-4.7',
      label: 'Grok 4.7',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'gpt-5.6-luna',
      label: 'GPT 5.6 Luna',
      provider: 'OpenCodeGo',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    const { baseUrl: configuredBaseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: 'OPENCODE_GO_API_BASE_URL',
      defaultApiTokenKey: 'OPENCODE_GO_API_KEY',
    });

    // The public endpoint is the default: only the key is required to list models.
    const baseUrl = configuredBaseUrl || OPENCODE_GO_BASE_URL;

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': OPENCODE_GO_USER_AGENT,
        },
        signal: this.createTimeoutSignal(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const res = (await response.json()) as { data: Array<{ id: string }> };
      const known = new Set(this.staticModels.map((m) => m.name));

      return res.data
        .filter((model) => !known.has(model.id))
        .map((model) => ({
          name: model.id,
          label: model.id,
          provider: this.name,
          maxTokenAllowed: 128000,
          maxCompletionTokens: 8192,
        }));
    } catch {
      // Model listing is optional; static models remain usable.
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

    const resolved = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: this.convertEnvToRecord(serverEnv),
      defaultBaseUrlKey: 'OPENCODE_GO_API_BASE_URL',
      defaultApiTokenKey: 'OPENCODE_GO_API_KEY',
    });

    /*
     * `getProviderBaseUrlAndKey` reads `process?.env` last, which a Worker does
     * not populate from the container environment. Fall back to the raw process
     * env (populated when the provider runs outside workerd) so a key supplied
     * via docker-compose still reaches the provider.
     */
    const env = typeof process !== 'undefined' ? process.env : undefined;

    const baseUrl = resolved.baseUrl || env?.OPENCODE_GO_API_BASE_URL || OPENCODE_GO_BASE_URL;
    const apiKey = resolved.apiKey || apiKeys?.[this.name] || env?.OPENCODE_GO_API_KEY;

    if (!baseUrl || !apiKey) {
      throw new Error(`Missing configuration for ${this.name} provider`);
    }

    const scope = sessionScope(model);

    const openai = createOpenAI({
      baseURL: baseUrl,
      apiKey,
      headers: {
        'x-opencode-session': scope,
        'User-Agent': OPENCODE_GO_USER_AGENT,
      },

      /*
       * Turn thinking OFF for every call.
       *
       * bolt.diy's agent loop always sends `tool_choice: 'required'` and a tight
       * token cap. With thinking left on (the gateway's default), deepseek-v4.1-flash
       * spends the whole budget on `reasoning_content` and returns `content: ""`
       * with ZERO tool calls — verified directly against the gateway. The agent loop
       * then receives a message that has neither text nor tool calls and throws a
       * TypeError, surfaced to the user as "The AI provider request failed".
       *
       * With `thinking: disabled` the same request returns a real `project_write_file`
       * tool call. Reasoning output is also what empties `content` on these models.
       *
       * Some models additionally reject `tool_choice: 'required'` outright while
       * thinking is enabled ("tool_choice 'required' is incompatible with thinking
       * enabled"), so this keeps every model usable with tool calls.
       */
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body);

            if (body && typeof body === 'object' && !body.thinking) {
              body.thinking = { type: 'disabled' };
              init = { ...init, body: JSON.stringify(body) };
            }
          } catch {
            /* Not JSON (or an empty body): leave the request untouched. */
          }
        }

        return fetch(input, init);
      },
    });

    return openai.chat(model);
  }
}
