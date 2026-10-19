/**
 * Model catalog for the togetherai provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider togetherai
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

export const TOGETHER_CATALOG: CatalogModel[] = [
  { id: 'deepseek-ai/DeepSeek-R1', label: "DeepSeek-R1", context: 163839, maxOutput: 163839, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 3, costOutput: 7, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'deepseek-ai/DeepSeek-V3', label: "DeepSeek-V3", context: 131072, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.25, costOutput: 1.25, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'deepseek-ai/DeepSeek-V3-1', label: "DeepSeek V3.1", context: 131072, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.6, costOutput: 1.7, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'deepseek-ai/DeepSeek-V4-Flash-0731', label: "DeepSeek V4 Flash 0731", context: 1048576, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.14, costOutput: 0.28, status: null, source: 'models.dev', canDisable: true, efforts: ['high', 'max'] },
  { id: 'deepseek-ai/DeepSeek-V4-Pro-0813', label: "DeepSeek V4 Pro 0813", context: 1048576, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.32, costOutput: 3.96, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'deepseek-ai/DeepSeek-V4.1-Flash', label: "DeepSeek V4.1 Flash", context: 1048576, maxOutput: 384000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'essentialai/Rnj-1-Instruct', label: "Rnj-1 Instruct", context: 32768, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.15, costOutput: 0.15, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'LiquidAI/LFM2-24B-A2B', label: "LFM2-24B-A2B", context: 32768, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 0.03, costOutput: 0.12, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: "Llama 3.3 70B", context: 131072, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.04, costOutput: 1.04, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'meta-models/Muse-Spark-Open-816B-A42B', label: "Muse Spark Open", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1.25, costOutput: 4.25, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'MiniMaxAI/MiniMax-M2.5', label: "MiniMax-M2.5", context: 204800, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 1.2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'MiniMaxAI/MiniMax-M2.7', label: "MiniMax-M2.7", context: 196608, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'MiniMaxAI/MiniMax-M3', label: "MiniMax-M3", context: 524288, maxOutput: 250000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'moonshotai/Kimi-K3', label: "Kimi K3", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 3, costOutput: 15, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: "Nemotron 3 Ultra 550B A55B", context: 512300, maxOutput: 512300, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.6, costOutput: 3.6, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL', label: "Nemotron 3.5 Super VL 120B A12B", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.5, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'openai/gpt-oss-120b', label: "GPT OSS 120B", context: 131072, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'Qwen/Qwen2.5-7B-Instruct-Turbo', label: "Qwen 2.5 7B Instruct Turbo", context: 32768, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.3, costOutput: 0.3, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput', label: "Qwen3 235B A22B Instruct 2507 FP8", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.2, costOutput: 0.6, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', label: "Qwen3 Coder 480B A35B Instruct", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2, costOutput: 2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'Qwen/Qwen3-Coder-Next-FP8', label: "Qwen3 Coder Next FP8", context: 262144, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.5, costOutput: 1.2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'Qwen/Qwen3.5-397B-A17B', label: "Qwen3.5 397B A17B", context: 262144, maxOutput: 130000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.6, costOutput: 3.6, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'Qwen/Qwen3.5-9B', label: "Qwen3.5 9B", context: 262144, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.17, costOutput: 0.25, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'Qwen/Qwen3.6-Plus', label: "Qwen3.6 Plus", context: 1000000, maxOutput: 500000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.5, costOutput: 3, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'Qwen/Qwen3.7-Max', label: "Qwen3.7 Max", context: 1000000, maxOutput: 500000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.25, costOutput: 3.75, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'reflection/Beam-1.0-501B-A23B', label: "Beam 1.0 501B A23B", context: 1048576, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.4, costOutput: 1.2, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'thinkingmachines/Inkling', label: "Inkling", context: 524288, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1, costOutput: 4.05, status: null, source: 'models.dev', canDisable: true, efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] },
  { id: 'zai-org/GLM-5', label: "GLM-5", context: 202752, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1, costOutput: 3.2, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'zai-org/GLM-5.1', label: "GLM-5.1", context: 202752, maxOutput: 131072, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'zai-org/GLM-5.2', label: "GLM-5.2", context: 1048575, maxOutput: 164000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: null, source: 'models.dev', canDisable: true, efforts: ['high', 'max'] },
  { id: 'zai-org/GLM-5.3', label: "GLM-5.3", context: 1048576, maxOutput: 262144, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 1.4, costOutput: 4.4, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'zai-org/GLM-5.3-Flash', label: "GLM-5.3-Flash", context: 1048575, maxOutput: 400000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.5, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = TOGETHER_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return TOGETHER_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return TOGETHER_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return TOGETHER_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
