/**
 * Model catalog for the fireworks-ai provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider fireworks-ai
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

export const FIREWORKS_CATALOG: CatalogModel[] = [
  { id: 'accounts/fireworks/models/deepseek-v4p1-flash', label: "DeepSeek V4.1 Flash", context: 1000000, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/models/deepseek-v4p1-flash-1017', label: "DeepSeek V4.1 Flash 1017", context: 1000000, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/models/ember-1', label: "Ember-1", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 3, costOutput: 15, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'accounts/fireworks/models/glm-5p3', label: "GLM 5.3", context: 1048573, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/models/glm-5p3-flash', label: "GLM 5.3 Flash", context: 1048573, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.5, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/models/gpt-oss-120b', label: "GPT OSS 120B", context: 131072, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'accounts/fireworks/models/inkling', label: "Inkling", context: 1048576, maxOutput: 1048576, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1, costOutput: 4.05, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'accounts/fireworks/models/kimi-k3', label: "Kimi K3", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 3, costOutput: 15, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'accounts/fireworks/models/minimax-m3', label: "MiniMax-M3", context: 512000, maxOutput: 512000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'accounts/fireworks/models/muse-spark-open', label: "Muse Spark Open", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1.25, costOutput: 4.25, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'accounts/fireworks/models/nemotron-3-ultra-nvfp4', label: "Nemotron 3 Ultra 550B A55B", context: 262144, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.6, costOutput: 2.4, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b', label: "Nemotron 3.5 Lightning 30B A3B", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.05, costOutput: 0.2, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'accounts/fireworks/models/qwen3p8-2p4t-a95b', label: "Qwen3.8 2.4T A95B", context: 262144, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'xhigh'] },
  { id: 'accounts/fireworks/models/qwen3p8-max', label: "Qwen3.8 Max", context: 262144, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'accounts/fireworks/routers/deepseek-flash-latest', label: "DeepSeek Flash Latest", context: 1000000, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/glm-5p3-fast', label: "GLM 5.3 Fast", context: 1048572, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2.1, costOutput: 6.6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/glm-fast-latest', label: "GLM 5.3 Fast (Latest)", context: 1048572, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2.1, costOutput: 6.6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/glm-flash-latest', label: "GLM Flash Latest (GLM 5.3 Flash)", context: 1048573, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.5, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/glm-latest', label: "GLM Latest", context: 1048573, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/kimi-fast-latest', label: "Kimi Fast Latest", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 4.5, costOutput: 22.5, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/kimi-k3-fast', label: "Kimi K3 Fast", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 4.5, costOutput: 22.5, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/kimi-latest', label: "Kimi Latest", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 3, costOutput: 15, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'accounts/fireworks/routers/minimax-latest', label: "MiniMax Latest", context: 512000, maxOutput: 512000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'accounts/fireworks/routers/qwen-max-latest', label: "Qwen Max Latest (Qwen3.8 Max)", context: 262144, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: true, efforts: [] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = FIREWORKS_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return FIREWORKS_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return FIREWORKS_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return FIREWORKS_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
