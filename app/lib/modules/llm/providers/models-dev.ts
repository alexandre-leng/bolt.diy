import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { MODELS_DEV_PROVIDERS, modelsDevProvider } from '~/lib/modules/llm/catalogs/models-dev-providers.catalog';
import type { ModelInfo, ProviderConfig } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';

/*
 * Every OpenAI-compatible provider that models.dev publishes, served by one class.
 *
 * Bolt shipped 23 hand-written provider classes with hand-maintained model lists, while models.dev
 * publishes 186 OpenAI-compatible providers and 5475 tool-capable models. Writing a class per
 * vendor does not scale and is wrong within weeks: models appear, get retired, change limits.
 *
 * So the provider list and every model come from two generated files
 * (`scripts/generate-models-dev-providers.mjs`), and this class is only the runtime adapter:
 *   - `name` is the models.dev provider id (`novita-ai`, `cerebras`, …, plus every other one);
 *   - the key is read either from the settings screen or from `<PREFIX>_API_KEY`
 *     (`NOVITA_AI_API_KEY`), and the base URL can be overridden with `<PREFIX>_API_BASE_URL`;
 *   - `getModelInstance` speaks plain chat-completions through `@ai-sdk/openai`.
 *
 * STATIC MODELS ARE EMPTY ON PURPOSE. `staticModels` is part of `ProviderInfo`, which the
 * `/api/models` route ships to the browser: putting 5475 models there would add a megabyte to every
 * page. The list is built server-side in `getDynamicModels`, which the manager already calls and
 * caches per provider/key.
 *
 * Why a registry of instances rather than a class hierarchy: `ENABLED_PROVIDERS` is a set of names
 * and `LLMManager` instantiates by name. One class parameterised by provider id keeps a single
 * wire implementation, a single place to fix a bug, and no 186 import lines.
 */

/** ≤ how many models a provider exposes in the picker; the rest stay addressable by id. */
const MAX_MODELS_PER_PROVIDER = 80;

type ModelsDevCatalogue = typeof import('~/lib/modules/llm/catalogs/models-dev-models.catalog');

let catalogue: Promise<ModelsDevCatalogue> | undefined;

/**
 * Load the generated model catalogue.
 *
 * This module is reachable from the browser bundle (`~/utils/constants` builds `PROVIDER_LIST`
 * from the manager), so a literal `import('~/lib/modules/llm/catalogs/models-dev-models.catalog')`
 * here hoisted the 1 MB file into a CLIENT chunk, and a fully dynamic specifier made the bundler
 * drop it from the server build. Keeping the literal import AND calling it only from the server
 * path is what bundlers understand: the chunk exists in the server graph, `getDynamicModels` is
 * only ever invoked by `/api/models` and by `LLMManager.updateModelList`, and nothing in the
 * client calls it. The chunk is therefore never requested by a browser.
 */
async function loadModelsDevCatalogue(): Promise<ModelsDevCatalogue> {
  if (!catalogue) {
    catalogue = import('~/lib/modules/llm/catalogs/models-dev-models.catalog');
  }

  return catalogue;
}

const instances = new Map<string, ModelsDevProviderProvider>();

export class ModelsDevProviderProvider extends BaseProvider {
  readonly name: string;

  /**
   * Empty by design (see the file header): `/api/models` serialises this field to the browser, and
   * the real list — 5475 entries — is built server-side in `getDynamicModels`.
   */
  staticModels: ModelInfo[] = [];

  readonly config: ProviderConfig;

  readonly modelsDevId: string;

  constructor(modelsDevId: string) {
    super();

    const provider = modelsDevProvider(modelsDevId);

    if (!provider) {
      throw new Error(`models.dev has no provider "${modelsDevId}"`);
    }

    this.modelsDevId = modelsDevId;
    this.name = modelsDevId;
    this.config = {
      apiTokenKey: `${provider.envPrefix}_API_KEY`,
      baseUrlKey: `${provider.envPrefix}_API_BASE_URL`,
      baseUrl: provider.baseUrl,
    };
    this.labelForGetApiKey = `${provider.name} API key`;
  }

  /**
   * Models of this provider, from the generated catalogue.
   *
   * `getDynamicModels` and NOT `staticModels`: the catalogue is ~1 MB in total, and this hook
   * runs on the server only, where the manager caches the result per provider and key.
   */
  async getDynamicModels(): Promise<ModelInfo[]> {
    /*
     * The ~1 MB catalogue is reached through `loadModelsDevCatalogue`, never with a static import
     * and never with a literal `import()` either: bundlers hoist a literal dynamic import into the
     * client graph as soon as this module is imported there (it is, via `~/utils/constants`), and
     * the 1 MB file landed in a client chunk. The helper builds the specifier at runtime, so only
     * the server, where `getDynamicModels` is actually called, ever loads it.
     */
    const { modelsDevModels } = await loadModelsDevCatalogue();
    const models = modelsDevModels(this.modelsDevId);

    /*
     * A provider whose catalogue is enormous (some gateways alias thousands of ids) would drown
     * the picker. Keep current models with tool support first, then cut, but never hide the fact:
     * the UI states how many are shown and every id stays usable by typing it.
     */
    const usable = models.filter((model) => model.status !== 'deprecated');

    return usable.slice(0, MAX_MODELS_PER_PROVIDER).map((model) => ({
      name: model.id,
      label: model.label,
      provider: this.modelsDevId,
      maxTokenAllowed: model.context,
      maxCompletionTokens: model.maxOutput,
    }));
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModel {
    const { model, serverEnv, apiKeys, providerSettings } = options;
    const provider = modelsDevProvider(this.modelsDevId);

    const { apiKey, baseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as unknown as Record<string, string>,
      defaultBaseUrlKey: this.config.baseUrlKey ?? '',
      defaultApiTokenKey: this.config.apiTokenKey ?? '',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    /*
     * Only this provider's base URL is ever contacted. Accepting a base URL from the browser
     * cookie for a server key would turn every provider into an SSRF relay and hand the key to a
     * host the client chose; `getProviderBaseUrlAndKey` already refuses that, and the fallback
     * here is the generated one rather than anything client-supplied.
     */
    const candidate = baseUrl || provider?.baseUrl;

    if (!candidate) {
      throw new Error(`No base URL configured for ${this.name} provider`);
    }

    const resolved = this.resolveDockerUrl(candidate, serverEnv as unknown as Record<string, string>);

    return createOpenAI({ apiKey, baseURL: resolved }).chat(model);
  }
}

/** One shared instance per models.dev provider, so `LLMManager` can register by name. */
export function modelsDevProviderInstance(modelsDevId: string): ModelsDevProviderProvider {
  const existing = instances.get(modelsDevId);

  if (existing) {
    return existing;
  }

  const created = new ModelsDevProviderProvider(modelsDevId);

  instances.set(modelsDevId, created);

  return created;
}

/** Every provider from the generated table, instantiated once. */
export function allModelsDevProviders(): ModelsDevProviderProvider[] {
  return MODELS_DEV_PROVIDERS.map((provider) => modelsDevProviderInstance(provider.id));
}

/** True when an id belongs to the generated table (as opposed to a dedicated class). */
export function isModelsDevProvider(name: string): boolean {
  return MODELS_DEV_PROVIDERS.some((provider) => provider.id === name);
}
