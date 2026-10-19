/**
 * Model catalog for the perplexity provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider perplexity
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

export const PERPLEXITY_CATALOG: CatalogModel[] = [
  { id: 'sonar', label: "Sonar", context: 128000, maxOutput: 4096, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 1, costOutput: 1, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'sonar-deep-research', label: "Perplexity Sonar Deep Research", context: 128000, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 2, costOutput: 8, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'sonar-pro', label: "Sonar Pro", context: 200000, maxOutput: 8192, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 3, costOutput: 15, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'sonar-reasoning-pro', label: "Sonar Reasoning Pro", context: 128000, maxOutput: 4096, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 2, costOutput: 8, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = PERPLEXITY_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return PERPLEXITY_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return PERPLEXITY_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return PERPLEXITY_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
