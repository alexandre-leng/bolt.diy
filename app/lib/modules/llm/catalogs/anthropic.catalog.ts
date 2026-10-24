/**
 * Model catalog for the anthropic provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider anthropic
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

export const ANTHROPIC_CATALOG: CatalogModel[] = [
  {
    id: 'claude-fable-5',
    label: 'Claude Fable 5',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 10,
    costOutput: 50,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 10,
    costOutput: 50,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5 (latest)',
    context: 200000,
    maxOutput: 64000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 1,
    costOutput: 5,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    context: 200000,
    maxOutput: 64000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 1,
    costOutput: 5,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 0.1,
    costOutput: 0.5,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-opus-4-5',
    label: 'Claude Opus 4.5 (latest)',
    context: 200000,
    maxOutput: 64000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 5,
    costOutput: 25,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'claude-opus-4-5-20251101',
    label: 'Claude Opus 4.5',
    context: 200000,
    maxOutput: 64000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 5,
    costOutput: 25,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 5,
    costOutput: 25,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'max'],
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 5,
    costOutput: 25,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 5,
    costOutput: 25,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 5,
    costOutput: 25,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 4,
    costOutput: 20,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5 (latest)',
    context: 200000,
    maxOutput: 64000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 3,
    costOutput: 15,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Claude Sonnet 4.5',
    context: 200000,
    maxOutput: 64000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 3,
    costOutput: 15,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 3,
    costOutput: 15,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'max'],
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 2,
    costOutput: 10,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    context: 1000000,
    maxOutput: 128000,
    protocol: 'messages',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 2,
    costOutput: 10,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = ANTHROPIC_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return ANTHROPIC_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return ANTHROPIC_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return ANTHROPIC_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
