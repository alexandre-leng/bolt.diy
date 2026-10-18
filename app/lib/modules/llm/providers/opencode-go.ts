import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import {
  OPENCODE_GO_CATALOG,
  catalogProtocol,
  catalogThinkingOnly,
} from '~/lib/modules/llm/catalogs/opencode-go.catalog';
import { keyFallbackFetch, orderedKeys } from '~/lib/modules/llm/providers/opencode-go-key-fallback';
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
 *
 * It was derived from the model alone, so every account and every conversation shared one
 * session — the opposite of the "stable per conversation" the gateway asks for: unrelated
 * chats competed for one backend pin and one prompt cache. `conversationKey` (the chat's
 * first message id, set per request by api.chat) is hashed in, so each chat gets its own
 * stable scope. Accepted by the gateway: verified live with a suffixed scope (200 + tool call).
 */
export function sessionScope(model: string, conversationKey?: string): string {
  const slug = (model || 'default').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  return conversationKey ? `bolt-diy-${slug}-c-${fnv1a(conversationKey)}` : `bolt-diy-${slug}`;
}

/** 32-bit FNV-1a, hex. A routing label, not a secret: it only has to be stable and short. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/*
 * Thinking-only models come from the generated catalog (catalogThinkingOnly), which records what
 * was measured against the gateway: a model listed there refuses `thinking: disabled` with a 400
 * ("GLM-5.3 is a thinking-only model; disabling thinking ... is not supported").
 *
 * /**
 * A 400 that refuses the `thinking` field we injected — not any 400 that merely mentions
 * "thinking" (a prompt echo or an unrelated validation message used to match).
 */
const THINKING_FIELD_REFUSED = /unknown field \\?"?thinking|thinking.*(not supported|unsupported|is a thinking-only)/i;

export function isThinkingFieldRefusal(detail: string): boolean {
  return THINKING_FIELD_REFUSED.test(detail);
}

/**
 * Which wire protocol the gateway speaks for a model.
 *
 * Everything went through `/chat/completions`, where the GPT, Grok and Claude models answer
 * 400 "Model does not support this protocol" — three models offered in the picker that could
 * never answer. Verified live: GPT and Grok answer on `/responses`, Claude on `/messages`.
 */
export function opencodeGoProtocol(model: string): 'chat' | 'responses' | 'messages' {
  return catalogProtocol(model);
}

/** Whether a chat-completions request for this model should carry `thinking: disabled`. */
export function shouldDisableThinking(model: string): boolean {
  return !catalogThinkingOnly(model);
}

export default class OpenCodeGoProvider extends BaseProvider {
  name = 'OpenCodeGo';
  getApiKeyLink = 'https://opencode.ai/auth';

  config = {
    baseUrlKey: 'OPENCODE_GO_API_BASE_URL',
    apiTokenKey: 'OPENCODE_GO_API_KEY',

    // The server's own endpoint: a cookie naming it is not a "client-chosen" host (see base-provider).
    baseUrl: OPENCODE_GO_BASE_URL,
  };

  /**
   * Models this provider offers, built from the generated catalog.
   *
   * The previous list was written by hand with `maxTokenAllowed: 128000` and
   * `maxCompletionTokens: 8192` on every entry: deepseek-v4.1-flash runs a 1,000,000-token
   * context with 384,000 output tokens, so Bolt was capping its own models at 13% of their
   * capacity, and 21 models the gateway serves were missing from the picker.
   */
  staticModels: ModelInfo[] = OPENCODE_GO_CATALOG.filter((entry) => entry.tools && entry.status !== 'deprecated').map(
    (entry) => ({
      name: entry.id,
      label: entry.label,
      provider: 'OpenCodeGo',
      maxTokenAllowed: entry.context,
      maxCompletionTokens: entry.maxOutput,
    }),
  );

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
        .map((model) => {
          /*
           * A model the catalog knows keeps its real limits; an unknown one gets the previous
           * conservative default and is labelled as such.
           */
          const entry = OPENCODE_GO_CATALOG.find((item) => item.id === model.id);

          return {
            name: model.id,
            label: entry ? entry.label : `${model.id} (non répertorié)`,
            provider: this.name,
            maxTokenAllowed: entry?.context ?? 128000,
            maxCompletionTokens: entry?.maxOutput ?? 8192,
          };
        });
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

    // Never the server key towards a host the client chose (cookie `providers.baseUrl`).
    const apiKey =
      resolved.apiKey || apiKeys?.[this.name] || (resolved.clientBaseUrl ? undefined : env?.OPENCODE_GO_API_KEY);

    if (!baseUrl || !apiKey) {
      throw new Error(`Missing configuration for ${this.name} provider`);
    }

    /*
     * Server keys (OPENCODE_GO_API_KEY, _2, _3) are rotated on 429/401. A key the client
     * supplied is never rotated: it is sent alone, as before.
     */
    const serverKeys = resolved.clientBaseUrl || resolved.apiKey || apiKeys?.[this.name] ? [] : orderedKeys(env ?? {});
    const rotatingFetch = serverKeys.length > 1 ? keyFallbackFetch(serverKeys, fetch) : undefined;

    const scope = sessionScope(model, providerSettings?.[this.name]?.sessionKey);

    const headers = {
      'x-opencode-session': scope,
      'User-Agent': OPENCODE_GO_USER_AGENT,
    };

    const protocol = opencodeGoProtocol(model);

    if (protocol === 'messages') {
      return createAnthropic({ baseURL: baseUrl, apiKey, headers, fetch: rotatingFetch })(model);
    }

    if (protocol === 'responses') {
      return createOpenAI({ baseURL: baseUrl, apiKey, headers, fetch: rotatingFetch }).responses(model);
    }

    const disableThinking = shouldDisableThinking(model);

    const openai = createOpenAI({
      baseURL: baseUrl,
      apiKey,
      headers,

      /*
       * Turn thinking OFF (except for thinking-only models, see the generated catalog).
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
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const original = init;

        if (disableThinking && init?.body && typeof init.body === 'string') {
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

        const transport = rotatingFetch ?? fetch;
        const response = await transport(input, init);

        /*
         * The gateway routes one model to different upstreams, and they disagree: the same
         * glm-5.3-flash accepted `thinking` on one probe and answered 400 `unknown field
         * "thinking"` on the next; glm-5.3 refuses to disable it. When the field we added is
         * what was refused, send the caller's request unchanged — for THIS request only. It used
         * to be remembered process-wide: one stray 400 re-enabled thinking on deepseek-v4.1-flash
         * for every user, and deepseek then returns no tool call at all.
         */
        if (init !== original && response.status === 400) {
          const detail = await response
            .clone()
            .text()
            .catch(() => '');

          if (isThinkingFieldRefusal(detail)) {
            return (rotatingFetch ?? fetch)(input, original);
          }
        }

        return response;
      },
    });

    return openai.chat(model);
  }
}
