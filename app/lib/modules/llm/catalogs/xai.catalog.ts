/**
 * Model catalog for the xai provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider xai
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

export const XAI_CATALOG: CatalogModel[] = [
  { id: 'grok-4.20-0309-non-reasoning', label: "Grok 4.20 (Non-Reasoning)", context: 1000000, maxOutput: 30000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 1.25, costOutput: 2.5, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'grok-4.20-0309-reasoning', label: "Grok 4.20 (Reasoning)", context: 1000000, maxOutput: 30000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 1.25, costOutput: 2.5, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'grok-4.20-multi-agent-0309', label: "Grok 4.20 Multi-Agent", context: 1000000, maxOutput: 30000, protocol: 'responses', thinkingOnly: false, vision: true, tools: false, costInput: 1.25, costOutput: 2.5, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-4.3', label: "Grok 4.3", context: 1000000, maxOutput: 30000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 1.25, costOutput: 2.5, status: null, source: 'models.dev', canDisable: true, efforts: ['none', 'low', 'medium', 'high'] },
  { id: 'grok-4.5', label: "Grok 4.5", context: 500000, maxOutput: 500000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'grok-4.6', label: "Grok 4.6", context: 500000, maxOutput: 500000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-4.7', label: "Grok 4.7", context: 500000, maxOutput: 500000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 6, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-build-0.1', label: "Grok Build 0.1", context: 256000, maxOutput: 256000, protocol: 'responses', thinkingOnly: false, vision: true, tools: true, costInput: 1, costOutput: 2, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'grok-imagine-image', label: "Grok Imagine Image", context: 16000, maxOutput: 0, protocol: 'responses', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'grok-imagine-image-quality', label: "Grok Imagine Image Quality", context: 16000, maxOutput: 0, protocol: 'responses', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'grok-imagine-video', label: "Grok Imagine Video", context: 1024, maxOutput: 0, protocol: 'responses', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'grok-imagine-video-1.5', label: "Grok Imagine Video 1.5", context: 1024, maxOutput: 0, protocol: 'responses', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'grok-imagine-video-1.5-lite', label: "Grok Imagine Video 1.5 Lite", context: 1024, maxOutput: 0, protocol: 'responses', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = XAI_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return XAI_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return XAI_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return XAI_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
