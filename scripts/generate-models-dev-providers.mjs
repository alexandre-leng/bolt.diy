#!/usr/bin/env node
/**
 * Generate the models.dev provider table and model catalogue from models.dev itself.
 *
 *   node scripts/generate-models-dev-providers.mjs            (writes both files)
 *   node scripts/generate-models-dev-providers.mjs --check    (fails if stale)
 *
 * WHY: Bolt shipped 23 hand-registered providers and 19 generated catalogs, while models.dev
 * publishes 235 providers and ~6500 models. Registering them by hand is a maintenance dead end;
 * this script turns the live catalogue into two checked-in TypeScript files, so the provider list
 * and each provider's models come from models.dev and never from a list somebody forgot to update.
 *
 * TWO FILES ON PURPOSE:
 *  - `models-dev-providers.catalog.ts` = id, label, base URL, env prefix. A few kilobytes, safe to
 *    import from anything, including the browser bundle.
 *  - `models-dev-models.catalog.ts` = every model of every provider (~1 MB). Imported ONLY by the
 *    server-side provider class, so the model list never lands in the client bundle.
 *
 * What is deliberately NOT here: the providers Bolt already implements with a dedicated class
 * (`DEDICATED` below). Their wire protocol is not plain chat-completions (Responses API, Messages
 * API, Gemini), so routing them through the generic path would break them.
 *
 * Filters, because a wrong entry is worse than a missing one:
 *  - an `api` base URL must be present (without it the provider cannot be called at all);
 *  - models without `tool_call` are skipped: Bolt's agent loop is tool-driven, and a model that
 *    cannot call a tool produces an empty turn instead of an error;
 *  - deprecated entries keep a `status`, so the UI can mark them instead of hiding them.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CATALOG_URL = process.env.MODELS_DEV_URL ?? 'https://models.dev/api.json?type=all';
const TARGET_PROVIDERS = 'app/lib/modules/llm/catalogs/models-dev-providers.catalog.ts';
const TARGET_MODELS = 'app/lib/modules/llm/catalogs/models-dev-models.catalog.ts';

/*
 * Providers Bolt already serves through a dedicated implementation. Key = models.dev id,
 * value = the class `name` already registered in manager.ts.
 *
 * Two are renamed on purpose: Bolt's Z.ai class talks to the API models.dev calls `zai`, and its
 * Github class is GitHub Copilot (`github-copilot`). Listing them here too would put the same
 * models in the picker twice.
 */
const DEDICATED = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  'google-vertex': 'Google',
  groq: 'Groq',
  huggingface: 'HuggingFace',
  cohere: 'Cohere',
  mistral: 'Mistral',
  perplexity: 'Perplexity',
  deepseek: 'Deepseek',
  xai: 'xAI',
  togetherai: 'Together',
  'fireworks-ai': 'Fireworks',
  cerebras: 'Cerebras',
  'amazon-bedrock': 'AmazonBedrock',
  'github-copilot': 'Github',
  moonshotai: 'Moonshot',
  zai: 'Z.ai',
  lmstudio: 'LMStudio',
  opencode: 'OpenCodeGo',
  'opencode-go': 'OpenCodeGo',
  openrouter: 'OpenRouter',
};

/** Providers usable through Bolt's generic OpenAI-compatible path. */
function isGeneric(provider) {
  return (
    provider.npm === '@ai-sdk/openai-compatible' && typeof provider.api === 'string' && provider.api.startsWith('http')
  );
}

function effortsOf(model) {
  const option = (model.reasoning_options ?? []).find((entry) => entry.type === 'effort');

  return option?.values ?? [];
}

function modelsOf(provider) {
  return Object.values(provider.models ?? {})
    .filter((model) => Boolean(model.tool_call))
    .map((model) => ({
      id: model.id,
      label: model.name ?? model.id,
      context: model.limit?.context ?? 128000,
      maxOutput: model.limit?.output ?? 8192,
      vision: (model.modalities?.input ?? []).some((mode) => mode === 'image' || mode === 'pdf'),
      costInput: model.cost?.input ?? null,
      costOutput: model.cost?.output ?? null,
      status: typeof model.status === 'string' ? model.status : null,
      efforts: effortsOf(model),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A stable, readable identifier from a models.dev provider id. */
function envPrefix(providerId) {
  return providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

const HEADER = `/**
 * Generated from https://models.dev/api.json?type=all.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-models-dev-providers.mjs
 *
 * models.dev (MIT) publishes every provider, its AI SDK package, the base URL of its API and the
 * capabilities of each model. These files are that catalogue reduced to what Bolt can call without
 * writing a provider class per vendor: the entries whose package is
 * \`@ai-sdk/openai-compatible\` and which publish an \`api\` URL.
 *
 * Providers Bolt already implements with a dedicated class (OpenAI, Anthropic, Google, OpenCode Go
 * and their key-based siblings) are NOT listed: they need their own wire protocol (Responses API,
 * Messages API, Gemini), so the runtime prefers the specific class and uses this table only for
 * everything else. See DEDICATED in the generator.
 *
 * The provider index and the model catalogue are split so the ~1 MB model list is imported only on
 * the server, never in the browser bundle.
 */`;

function renderProviders(providers, generatedAt) {
  const body = providers
    .map(
      (provider) =>
        `  { id: ${JSON.stringify(provider.id)}, name: ${JSON.stringify(provider.name)}, ` +
        `baseUrl: ${JSON.stringify(provider.baseUrl)}, envPrefix: ${JSON.stringify(provider.envPrefix)} },`,
    )
    .join('\n');

  return `${HEADER}

export interface ModelsDevProvider {
  /** models.dev provider id, which is also the key the settings screen stores. */
  id: string;
  name: string;
  /** OpenAI-compatible base URL; a request goes to \`\${baseUrl}/chat/completions\`. */
  baseUrl: string;
  /** Prefix of this provider's key variables (\`<PREFIX>_API_KEY\`, \`<PREFIX>_API_BASE_URL\`). */
  envPrefix: string;
}

/** Date of generation; the script rewrites it, so a stale file is visible at a glance. */
export const MODELS_DEV_GENERATED_AT = ${JSON.stringify(generatedAt)};

export const MODELS_DEV_PROVIDERS: ModelsDevProvider[] = [
${body}
];

/** Provider by models.dev id. */
export function modelsDevProvider(id: string): ModelsDevProvider | undefined {
  return MODELS_DEV_PROVIDERS.find((provider) => provider.id === id);
}
`;
}

function renderModels(providers, generatedAt) {
  const body = providers
    .map(
      (provider) =>
        `  ${JSON.stringify(provider.id)}: [\n` +
        provider.models
          .map(
            (model) =>
              `    { id: ${JSON.stringify(model.id)}, label: ${JSON.stringify(model.label)}, ` +
              `context: ${model.context}, maxOutput: ${model.maxOutput}, vision: ${model.vision}, ` +
              `costInput: ${model.costInput ?? 'null'}, costOutput: ${model.costOutput ?? 'null'}, ` +
              `status: ${model.status ? JSON.stringify(model.status) : 'null'}, ` +
              `efforts: [${model.efforts.map((value) => JSON.stringify(value)).join(', ')}] },`,
          )
          .join('\n') +
        `\n  ],`,
    )
    .join('\n');

  return `${HEADER}

export interface ModelsDevModel {
  /** Model id as that provider's API expects it. */
  id: string;
  label: string;
  /** Context window in tokens, from models.dev. */
  context: number;
  /** Maximum output tokens, from models.dev. */
  maxOutput: number;
  /** True for text + image input. */
  vision: boolean;
  /** USD per million tokens, or null when models.dev publishes no price. */
  costInput: number | null;
  costOutput: number | null;
  /** models.dev lifecycle status ('deprecated', 'alpha'…), null when current. */
  status: string | null;
  /** Reasoning levels the model accepts, from models.dev (\`reasoning_effort\` values). */
  efforts: string[];
}

/** Date of generation; the script rewrites it, so a stale file is visible at a glance. */
export const MODELS_DEV_MODELS_GENERATED_AT = ${JSON.stringify(generatedAt)};

/** Every model, keyed by models.dev provider id. Server-side only: this file is ~1 MB. */
export const MODELS_DEV_MODELS: Record<string, ModelsDevModel[]> = {
${body}
};

/** Every model of a provider, or an empty list when the provider is unknown. */
export function modelsDevModels(providerId: string): ModelsDevModel[] {
  return MODELS_DEV_MODELS[providerId] ?? [];
}

/** One model of one provider. */
export function modelsDevModel(providerId: string, modelId: string): ModelsDevModel | undefined {
  return modelsDevModels(providerId).find((model) => model.id === modelId);
}

/** Reasoning levels accepted by a model; empty when it takes no effort parameter. */
export function modelsDevEfforts(providerId: string, modelId: string): string[] {
  return modelsDevModel(providerId, modelId)?.efforts ?? [];
}
`;
}

async function fetchCatalog() {
  const response = await fetch(CATALOG_URL, { headers: { 'user-agent': 'bolt-model-catalog/1.0' } });

  if (!response.ok) {
    throw new Error(`models.dev answered ${response.status}`);
  }

  return response.json();
}

function build(catalog) {
  const providers = [];

  for (const [id, provider] of Object.entries(catalog)) {
    if (Object.prototype.hasOwnProperty.call(DEDICATED, id) || !isGeneric(provider)) {
      continue;
    }

    const models = modelsOf(provider);

    if (models.length === 0) {
      continue;
    }

    providers.push({
      id,
      name: provider.name ?? id,
      baseUrl: provider.api.replace(/\/+$/, ''),
      envPrefix: envPrefix(id),
      models,
    });
  }

  return providers.sort((a, b) => a.id.localeCompare(b.id));
}

/** A stale table is detected on the provider index alone: it is small and changes with the models. */
async function stale(target, index) {
  if (!existsSync(target)) {
    return `table absente: ${path.relative(ROOT, target)}`;
  }

  const current = await readFile(target, 'utf8');
  const ids = (text) => JSON.stringify(text.match(/^  \{ id: .*$/gm) ?? []);

  return ids(current) === ids(index) ? null : 'table périmée: relancez le script et commitez le résultat';
}

async function main() {
  const check = process.argv.includes('--check');
  const catalog = await fetchCatalog();
  const providers = build(catalog);
  const today = new Date().toISOString().slice(0, 10);
  const indexPath = path.join(ROOT, TARGET_PROVIDERS);
  const modelsPath = path.join(ROOT, TARGET_MODELS);
  const models = providers.reduce((total, provider) => total + provider.models.length, 0);

  if (check) {
    const problem = await stale(indexPath, renderProviders(providers, today));

    console.log(problem ?? `table à jour (${providers.length} fournisseurs, ${models} modèles)`);
    process.exit(problem ? 1 : 0);
  }

  await writeFile(indexPath, renderProviders(providers, today), 'utf8');
  await writeFile(modelsPath, renderModels(providers, today), 'utf8');
  console.log(`${providers.length} fournisseurs et ${models} modèles dans ${TARGET_PROVIDERS} + ${TARGET_MODELS}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
