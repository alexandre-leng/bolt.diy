/**
 * Model catalog for the deepseek provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider deepseek
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

export const DEEPSEEK_CATALOG: CatalogModel[] = [
  { id: 'deepseek-flash', label: "DeepSeek V4.1 Flash 1017", context: 1000000, maxOutput: 393216, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'deepseek-v4-flash', label: "DeepSeek V4 Flash", context: 1000000, maxOutput: 393216, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.6, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'deepseek-v4-flash-vision-exp', label: "DeepSeek V4 Flash Vision Exp", context: 1000000, maxOutput: 393216, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.15, costOutput: 0.6, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
  { id: 'deepseek-v4-pro', label: "DeepSeek V4 Pro", context: 1000000, maxOutput: 393216, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.66, costOutput: 1.98, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high', 'max'] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = DEEPSEEK_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return DEEPSEEK_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return DEEPSEEK_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return DEEPSEEK_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
