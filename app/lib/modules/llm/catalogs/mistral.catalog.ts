/**
 * Model catalog for the mistral provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider mistral
 *
 * models.dev is MIT licensed and publishes model limits, pricing and capabilities; the previous
 * hand-written list capped every model at 128k/8k and omitted models the gateway serves.
 * Local corrections (which models refuse `thinking: disabled`, which are of no use here) live in
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
  /** True when the model refuses `thinking: disabled`. */
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
  /** False for a thinking-only model: it refuses `thinking: disabled` (a 400 when forced). */
  canDisable: boolean;
  /** Reasoning levels the model accepts, from models.dev (`reasoning_effort` values). */
  efforts: string[];
}

/** Date of generation; the script rewrites it, so a stale file is visible at a glance. */
export const CATALOG_GENERATED_AT = '2026-10-19';

export const MISTRAL_CATALOG: CatalogModel[] = [
  { id: 'codestral-2508', label: "Codestral 25.08", context: 256000, maxOutput: 8192, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 0.9, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'codestral-latest', label: "Codestral (latest)", context: 256000, maxOutput: 4096, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 0.9, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'devstral-2512', label: "Devstral 2", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.4, costOutput: 2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'devstral-latest', label: "Devstral 2", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.4, costOutput: 2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'devstral-medium-2507', label: "Devstral Medium", context: 128000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.4, costOutput: 2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'devstral-medium-latest', label: "Devstral 2 (latest)", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.4, costOutput: 2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'devstral-small-2505', label: "Devstral Small 2505", context: 128000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.1, costOutput: 0.3, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'devstral-small-2507', label: "Devstral Small", context: 128000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.1, costOutput: 0.3, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'glm-5-2', label: "GLM-5.2", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['none', 'high', 'max'] },
  { id: 'labs-devstral-small-2512', label: "Devstral Small 2", context: 256000, maxOutput: 256000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0, costOutput: 0, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'labs-leanstral-1-5-1', label: "Leanstral 1.5", context: 262144, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0, costOutput: 0, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'magistral-medium-latest', label: "Magistral Medium (latest)", context: 262144, maxOutput: 16384, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 5, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'ministral-14b-2512', label: "Ministral 3 14B", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.2, costOutput: 0.2, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'ministral-3b-2512', label: "Ministral 3 3B", context: 131072, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.1, costOutput: 0.1, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'ministral-3b-latest', label: "Ministral 3B (latest)", context: 131072, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.04, costOutput: 0.04, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'ministral-8b-2512', label: "Ministral 3 8B", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.15, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'ministral-8b-latest', label: "Ministral 8B (latest)", context: 262144, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.1, costOutput: 0.1, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-embed', label: "Mistral Embed", context: 8000, maxOutput: 3072, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 0.1, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-large-2411', label: "Mistral Large 2.1", context: 131072, maxOutput: 16384, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2, costOutput: 6, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-large-2512', label: "Mistral Large 3", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.5, costOutput: 1.5, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-large-4', label: "Mistral Large 4", context: 1048576, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.68, costOutput: 2.09, status: 'beta', source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'mistral-large-latest', label: "Mistral Large (latest)", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.5, costOutput: 1.5, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-medium-2505', label: "Mistral Medium 3", context: 131072, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.4, costOutput: 2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-medium-2508', label: "Mistral Medium 3.1", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.4, costOutput: 2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-medium-2604', label: "Mistral Medium 3.5", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1.5, costOutput: 7.5, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'mistral-medium-latest', label: "Mistral Medium (latest)", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1.5, costOutput: 7.5, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'mistral-nemo', label: "Mistral Nemo", context: 128000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.15, costOutput: 0.15, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-small-2506', label: "Mistral Small 3.2", context: 128000, maxOutput: 16384, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.1, costOutput: 0.3, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mistral-small-2603', label: "Mistral Small 4", context: 262144, maxOutput: 256000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'mistral-small-latest', label: "Mistral Small (latest)", context: 262144, maxOutput: 256000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'open-mistral-7b', label: "Mistral 7B", context: 8000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.25, costOutput: 0.25, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'open-mistral-nemo', label: "Open Mistral Nemo", context: 128000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.15, costOutput: 0.15, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'open-mixtral-8x22b', label: "Mixtral 8x22B", context: 64000, maxOutput: 64000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2, costOutput: 6, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'open-mixtral-8x7b', label: "Mixtral 8x7B", context: 32000, maxOutput: 32000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.7, costOutput: 0.7, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'pixtral-12b', label: "Pixtral 12B", context: 128000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.15, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'pixtral-large-latest', label: "Pixtral Large (latest)", context: 128000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 6, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'voxtral-mini-latest', label: "Voxtral Mini (latest)", context: 0, maxOutput: 0, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'voxtral-mini-tts-latest', label: "Voxtral Mini TTS (latest)", context: 0, maxOutput: 0, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'voxtral-small-2507', label: "Voxtral Small", context: 32768, maxOutput: 32000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.1, costOutput: 0.4, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'voxtral-small-latest', label: "Voxtral Small (latest)", context: 32768, maxOutput: 32000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.1, costOutput: 0.3, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'zai-glm-5-2', label: "GLM-5.2", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['none', 'high', 'max'] },
  { id: 'zai-glm-5-3', label: "GLM-5.3", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = MISTRAL_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return MISTRAL_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return MISTRAL_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return MISTRAL_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
