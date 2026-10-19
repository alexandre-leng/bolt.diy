/**
 * Model catalog for the cohere provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider cohere
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

export const COHERE_CATALOG: CatalogModel[] = [
  { id: 'c4ai-aya-expanse-32b', label: "Aya Expanse 32B", context: 128000, maxOutput: 4000, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'c4ai-aya-vision-32b', label: "Aya Vision 32B", context: 16000, maxOutput: 4000, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-a-03-2025', label: "Command A", context: 256000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2.5, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-a-plus-05-2026', label: "Command A Plus", context: 128000, maxOutput: 64000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2.5, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-a-reasoning-08-2025', label: "Command A Reasoning", context: 256000, maxOutput: 32000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2.5, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-a-translate-08-2025', label: "Command A Translate", context: 8000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2.5, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-a-vision-07-2025', label: "Command A Vision", context: 128000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 2.5, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-r-08-2024', label: "Command R", context: 128000, maxOutput: 4000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.15, costOutput: 0.6, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-r-plus-08-2024', label: "Command R+", context: 128000, maxOutput: 4000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 2.5, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-r7b-12-2024', label: "Command R7B", context: 128000, maxOutput: 4000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.0375, costOutput: 0.15, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'command-r7b-arabic-02-2025', label: "Command R7B Arabic", context: 128000, maxOutput: 4000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0.0375, costOutput: 0.15, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'north-mini-code-1-0', label: "North Mini Code", context: 256000, maxOutput: 64000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: 0, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'high'] },
  { id: 'north-small-translate-09-2026', label: "North Small Translate", context: 32768, maxOutput: 16000, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 0, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'tiny-aya-earth', label: "Tiny Aya Earth", context: 8000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'tiny-aya-fire', label: "Tiny Aya Fire", context: 8000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'tiny-aya-global', label: "Tiny Aya Global", context: 8000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'tiny-aya-water', label: "Tiny Aya Water", context: 8000, maxOutput: 8000, protocol: 'chat', thinkingOnly: false, vision: false, tools: true, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = COHERE_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return COHERE_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return COHERE_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return COHERE_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
