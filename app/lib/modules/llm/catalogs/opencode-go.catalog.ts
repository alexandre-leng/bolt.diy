/**
 * Model catalog for the opencode-go provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider opencode-go
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

export const OPENCODE_GO_CATALOG: CatalogModel[] = [
  { id: 'beam-free', label: "Beam Free (gratuit)", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'cat-jam-free', label: "Cat Jam Free (gratuit)", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0, costOutput: 0, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-5-5', label: "Claude Haiku 5.5", context: 1000000, maxOutput: 128000, protocol: 'messages', thinkingOnly: true, vision: true, tools: true, costInput: 0.1, costOutput: 0.5, status: null, source: 'models.dev', canDisable: false, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'deepseek-v4-pro', label: "DeepSeek V4 Pro (New)", context: 1000000, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.66, costOutput: 1.98, status: null, source: 'models.dev', canDisable: true, efforts: ['high', 'max'] },
  { id: 'deepseek-v4.1-flash', label: "DeepSeek V4.1 Flash", context: 1000000, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'gemini-4-argon-contributor', label: "Gemini 4 Argon Contributor (contributeur)", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 4, costOutput: 20, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'glm-5.2', label: "GLM-5.2", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: null, source: 'models.dev', canDisable: true, efforts: ['high', 'max'] },
  { id: 'glm-5.3', label: "GLM-5.3", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: true, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: null, source: 'models.dev', canDisable: false, efforts: ['low', 'high', 'max'] },
  { id: 'glm-5.3-flash', label: "GLM-5.3-Flash", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.5, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'gpt-5.6-luna', label: "GPT-5.6 Luna", context: 1050000, maxOutput: 128000, protocol: 'responses', thinkingOnly: true, vision: true, tools: true, costInput: 0.2, costOutput: 1.2, status: null, source: 'models.dev', canDisable: false, efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-6-luna', label: "GPT-6 Luna", context: 1050000, maxOutput: 128000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 0.1, costOutput: 0.5, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'grok-4.7', label: "Grok 4.7", context: 500000, maxOutput: 500000, protocol: 'responses', thinkingOnly: true, vision: true, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: false, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'hy3', label: "Hy3", context: 256000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.14, costOutput: 0.58, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'low', 'high'] },
  { id: 'hy4-preview', label: "Hy4 preview", context: 1024000, maxOutput: 64000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.834, costOutput: 2.501, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'kimi-k2.7-code', label: "Kimi K2.7 Code", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.95, costOutput: 4, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'kimi-k3', label: "Kimi K3", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 3, costOutput: 15, status: null, source: 'models.dev', canDisable: true, efforts: ['max'] },
  { id: 'longcat-2.0', label: "LongCat-2.0", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'longcat-2.5-preview-free', label: "LongCat 2.5 Preview Free (gratuit)", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mimo-v2.5', label: "MiMo V2.5", context: 1000000, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.14, costOutput: 0.28, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mimo-v2.5-pro', label: "MiMo V2.5 Pro", context: 1048576, maxOutput: 128000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.435, costOutput: 0.87, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mimo-v2.6-flash', label: "MiMo-V2.6-Flash", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.14, costOutput: 0.28, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'mimo-v2.6-pro', label: "MiMo-V2.6-Pro", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.435, costOutput: 0.87, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'minimax-m2.7', label: "MiniMax-M2.7", context: 204800, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 1.2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'minimax-m3', label: "MiniMax-M3", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'muse-spark-1.2-contributor', label: "Muse Spark 1.2 Contributor (contributeur)", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.1, costOutput: 0.2, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  { id: 'muse-spark-1.3-contributor', label: "Muse Spark 1.3 Contributor (contributeur)", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.1, costOutput: 0.2, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  { id: 'qwen3.7-plus', label: "Qwen3.7 Plus", context: 1000000, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.4, costOutput: 1.6, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'qwen3.8-flash', label: "Qwen3.8 Flash", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.47, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'xhigh'] },
  { id: 'qwen3.8-max', label: "Qwen3.8 Max", context: 1000000, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'xhigh'] },
  { id: 'space-bunny', label: "Space Bunny", context: 1048576, maxOutput: 524288, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'step-5-preview', label: "Step 5 Preview", context: 1000000, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1, costOutput: 2.7, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = OPENCODE_GO_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return OPENCODE_GO_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return OPENCODE_GO_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return OPENCODE_GO_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
