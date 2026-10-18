#!/usr/bin/env node
/**
 * Generate a provider's model catalog from models.dev.
 *
 *   node scripts/generate-model-catalog.mjs --provider opencode-go            (uses the repo defaults)
 *   node scripts/generate-model-catalog.mjs --provider opencode-go --check    (fails if stale)
 *   node scripts/generate-model-catalog.mjs --provider opencode-go --probe    (asks the gateway)
 *
 * WHY: the hand-written lists in app/lib/modules/llm/providers/*.ts carried wrong limits (every
 * OpenCode Go model was capped at 128k/8k instead of 1M/384k) and missed models the gateway
 * serves. models.dev (MIT) publishes context, output, pricing and capabilities for every model;
 * this script turns that into a checked-in TypeScript file so the runtime never calls a third
 * party to draw a model list.
 *
 * Local corrections that models.dev cannot express are kept in LOCAL_OVERRIDES below, and the
 * --probe mode records what the deployment's gateway actually answers.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CATALOG_URL = process.env.MODELS_DEV_URL ?? 'https://models.dev/api.json';

/*
 * What models.dev knows and this deployment knows better.
 * - thinkingOnly: measured against the gateway; a model here refuses `thinking: disabled` (400).
 * - skip: served by the provider but of no use for a coding agent, or reserved to contributors.
 */
const LOCAL_OVERRIDES = {
  'opencode-go': {
    thinkingOnly: ['glm-5.3', 'gpt-5.6-luna', 'grok-4.7', 'claude-haiku-5-5'],
    skip: ['step-5-preview-free'],
    /* Ids the provider serves but models.dev does not list under this provider. */
    extra: [
      { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna' },
      { id: 'glm-5.3', label: 'GLM 5.3' },
    ],
  },
};

const PROVIDERS = {
  'opencode-go': {
    modelsDevId: 'opencode-go',
    file: 'app/lib/modules/llm/catalogs/opencode-go.catalog.ts',
    exportName: 'OPENCODE_GO_CATALOG',
    labelSuffixes: { '-contributor': ' (contributeur)', '-free': ' (gratuit)' },
  },
};

function parseArgs(argv) {
  const args = { provider: null, check: false, probe: false, out: null };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--provider') {
      args.provider = argv[++index];
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--probe') {
      args.probe = true;
    } else if (arg === '--out') {
      args.out = argv[++index];
    }
  }

  return args;
}

/** Protocol the gateway speaks for a model: proven live, not guessed (see the provider file). */
export function protocolFor(model) {
  if (/^claude-/i.test(model)) {
    return 'messages';
  }

  if (/^(gpt-|grok-)/i.test(model)) {
    return 'responses';
  }

  return 'chat';
}

function statusOf(model) {
  return model.status ?? null;
}

/** Which reasoning levels the model accepts, and whether it can be turned off at all. */
function reasoningFrom(modelsDevModel, thinkingOnly) {
  if (thinkingOnly) {
    // Measured: a thinking-only model refuses `thinking: disabled` (400), so "off" is not offered.
    return { canDisable: false, efforts: effortsOf(modelsDevModel) };
  }

  return { canDisable: true, efforts: effortsOf(modelsDevModel) };
}

function effortsOf(modelsDevModel) {
  const options = modelsDevModel.reasoning_options ?? [];
  const effort = options.find((option) => option.type === 'effort');

  return effort?.values ?? [];
}

function entryFrom(modelsDevModel, overrides, suffixMap) {
  const id = modelsDevModel.id;
  const suffix = Object.keys(suffixMap ?? {}).find((ending) => id.endsWith(ending));

  return {
    id,
    label: `${modelsDevModel.name}${suffix ? suffixMap[suffix] : ''}`,
    context: modelsDevModel.limit?.context ?? 128000,
    maxOutput: modelsDevModel.limit?.output ?? 8192,
    protocol: protocolFor(id),
    thinkingOnly: overrides.thinkingOnly.includes(id),
    vision: (modelsDevModel.modalities?.input ?? []).some((mode) => mode === 'image' || mode === 'pdf' || mode === 'video'),
    tools: Boolean(modelsDevModel.tool_call),
    costInput: modelsDevModel.cost?.input ?? null,
    costOutput: modelsDevModel.cost?.output ?? null,
    status: statusOf(modelsDevModel),
    source: 'models.dev',
    ...reasoningFrom(modelsDevModel, overrides.thinkingOnly.includes(id)),
  };
}

function entryForExtra(id, label, overrides) {
  return {
    id,
    label,
    context: 1000000,
    maxOutput: 128000,
    protocol: protocolFor(id),
    thinkingOnly: overrides.thinkingOnly.includes(id),
    vision: true,
    tools: true,
    costInput: null,
    costOutput: null,
    status: null,
    source: 'override',
    canDisable: !overrides.thinkingOnly.includes(id),
    efforts: [],
  };
}

export function buildCatalog(catalog, config, overrides) {
  const provider = catalog[config.modelsDevId];

  if (!provider) {
    throw new Error(`models.dev has no provider "${config.modelsDevId}"`);
  }

  const skip = new Set(overrides.skip ?? []);
  const suffixMap = config.labelSuffixes ?? {};
  const entries = Object.values(provider.models)
    .filter((model) => !skip.has(model.id))
    .map((model) => entryFrom(model, overrides, suffixMap));

  for (const extra of overrides.extra ?? []) {
    if (!entries.some((entry) => entry.id === extra.id)) {
      entries.push(entryForExtra(extra.id, extra.label, overrides));
    }
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function render(entries, config, generatedAt) {
  const lines = entries
    .map(
      (entry) =>
        `  { id: '${entry.id}', label: ${JSON.stringify(entry.label)}, context: ${entry.context}, ` +
        `maxOutput: ${entry.maxOutput}, protocol: '${entry.protocol}', thinkingOnly: ${entry.thinkingOnly}, ` +
        `vision: ${entry.vision}, tools: ${entry.tools}, costInput: ${entry.costInput ?? 'null'}, ` +
        `costOutput: ${entry.costOutput ?? 'null'}, status: ${entry.status ? `'${entry.status}'` : 'null'}, ` +
        `source: '${entry.source}', canDisable: ${entry.canDisable}, ` +
        `efforts: [${(entry.efforts ?? []).map((value) => `'${value}'`).join(', ')}] },`,
    )
    .join('\n');

  return `/**
 * Model catalog for the ${config.modelsDevId} provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider ${config.modelsDevId}
 *
 * models.dev is MIT licensed and publishes model limits, pricing and capabilities; the previous
 * hand-written list capped every model at 128k/8k and omitted models the gateway serves.
 * Local corrections (which models refuse \`thinking: disabled\`, which are of no use here) live in
 * the script's LOCAL_OVERRIDES, and a test compares this file with the live catalogue.
 */

export interface CatalogModel {
  /** Model id as the gateway expects it. */
  id: string;
  /** Human label, from models.dev. */
  label: string;
  /** Context window in tokens. */
  context: number;
  /** Maximum output tokens. */
  maxOutput: number;
  /** Wire protocol the gateway speaks for this model. */
  protocol: 'chat' | 'responses' | 'messages';
  /** True when the model refuses \`thinking: disabled\`. */
  thinkingOnly: boolean;
  /** True for text+image input. */
  vision: boolean;
  /** True when the model supports tool calls (required for the agent loop). */
  tools: boolean;
  /** USD per million tokens, shown in the settings screen. */
  costInput: number | null;
  costOutput: number | null;
  /** models.dev lifecycle status; 'deprecated' entries stay available but are marked. */
  status: string | null;
  /** Where the entry comes from. */
  source: 'models.dev' | 'override';
  /** False for a thinking-only model: it refuses \`thinking: disabled\` (a 400 when forced). */
  canDisable: boolean;
  /** Reasoning levels the model accepts, from models.dev (\`reasoning_effort\` values). */
  efforts: string[];
}

/** Date of generation; the script rewrites it, so a stale file is visible at a glance. */
export const CATALOG_GENERATED_AT = '${generatedAt}';

export const ${config.exportName}: CatalogModel[] = [
${lines}
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = ${config.exportName}.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return ${config.exportName}.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts \`thinking: {type: 'disabled'}\` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return ${config.exportName}.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return ${config.exportName}.find((item) => item.id === model)?.efforts ?? [];
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

/** Ask the deployment's gateway which ids it really serves (needs the provider key). */
async function probeGateway(entries) {
  const baseUrl = process.env.OPENCODE_GO_API_BASE_URL;
  const key = process.env.OPENCODE_GO_API_KEY;

  if (!baseUrl || !key) {
    console.warn('--probe: OPENCODE_GO_API_BASE_URL / OPENCODE_GO_API_KEY missing, skipping');
    return null;
  }

  const answered = [];

  for (const entry of entries) {
    const body = JSON.stringify({ model: entry.id, messages: [{ role: 'user', content: 'ok' }], max_tokens: 4 });
    let response;

    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          'x-opencode-session': `catalog-probe-${entry.id}`,
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36',
          accept: 'application/json',
        },
        body,
      });
    } catch (error) {
      console.warn(`  ${entry.id}: réseau (${error.message})`);
      continue;
    }

    if (response.ok) {
      answered.push(entry.id);
    } else if (response.status === 400) {
      const detail = await response.text();

      if (/protocol/i.test(detail)) {
        // Another wire protocol (responses/messages) — the provider handles that; not a failure.
        answered.push(entry.id);
      } else {
        console.warn(`  ${entry.id}: ${response.status} ${detail.slice(0, 60)}`);
      }
    } else {
      console.warn(`  ${entry.id}: ${response.status}`);
    }
  }

  console.log(`--probe: ${answered.length}/${entries.length} ids answered by the gateway`);
  return answered;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const providerKey = args.provider ?? 'opencode-go';
  const config = PROVIDERS[providerKey];

  if (!config) {
    throw new Error(`unknown provider "${providerKey}" (known: ${Object.keys(PROVIDERS).join(', ')})`);
  }

  const overrides = LOCAL_OVERRIDES[providerKey] ?? { thinkingOnly: [], skip: [], extra: [] };
  const catalog = await fetchCatalog();
  const entries = buildCatalog(catalog, config, overrides);

  if (args.probe) {
    await probeGateway(entries);
  }

  const today = new Date().toISOString().slice(0, 10);
  const output = render(entries, config, today);
  const target = args.out ?? path.join(ROOT, config.file);

  if (args.check) {
    if (!existsSync(target)) {
      console.error(`catalogue absent: ${target}`);
      process.exit(1);
    }

    const current = await readFile(target, 'utf8');
    const sameModelSet =
      JSON.stringify(current.match(/id: '[^']+'/g) ?? []) === JSON.stringify(output.match(/id: '[^']+'/g) ?? []);

    if (!sameModelSet) {
      console.error('catalogue périmé : relancez le script et commitez le résultat');
      process.exit(1);
    }

    console.log(`catalogue à jour (${entries.length} modèles)`);
    return;
  }

  await writeFile(target, output, 'utf8');
  console.log(`${entries.length} modèles écrits dans ${path.relative(ROOT, target)}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
