/**
 * Model catalog for the groq provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider groq
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

export const GROQ_CATALOG: CatalogModel[] = [
  {
    id: 'allam-2-7b',
    label: 'ALLaM-2-7b',
    context: 4096,
    maxOutput: 4096,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: 0,
    costOutput: 0,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'canopylabs/orpheus-arabic-saudi',
    label: 'Canopy Labs Orpheus Arabic Saudi',
    context: 4000,
    maxOutput: 50000,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: null,
    costOutput: null,
    status: 'beta',
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'canopylabs/orpheus-v1-english',
    label: 'Canopy Labs Orpheus V1 English',
    context: 4000,
    maxOutput: 50000,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: null,
    costOutput: null,
    status: 'beta',
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'groq/compound',
    label: 'Compound',
    context: 131072,
    maxOutput: 8192,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: null,
    costOutput: null,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'groq/compound-mini',
    label: 'Compound Mini',
    context: 131072,
    maxOutput: 8192,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: null,
    costOutput: null,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B',
    context: 131072,
    maxOutput: 131072,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: true,
    costInput: 0.05,
    costOutput: 0.08,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B',
    context: 131072,
    maxOutput: 32768,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: true,
    costInput: 0.59,
    costOutput: 0.79,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'meta-llama/llama-prompt-guard-2-22m',
    label: 'Llama Prompt Guard 2 22M',
    context: 512,
    maxOutput: 512,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: 0.03,
    costOutput: 0.03,
    status: 'beta',
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'meta-llama/llama-prompt-guard-2-86m',
    label: 'Prompt Guard 2 86M',
    context: 512,
    maxOutput: 512,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: 0.04,
    costOutput: 0.04,
    status: 'beta',
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT OSS 120B',
    context: 131072,
    maxOutput: 65536,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: true,
    costInput: 0.15,
    costOutput: 0.6,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT OSS 20B',
    context: 131072,
    maxOutput: 65536,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: true,
    costInput: 0.075,
    costOutput: 0.3,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'openai/gpt-oss-safeguard-20b',
    label: 'Safety GPT OSS 20B',
    context: 131072,
    maxOutput: 65536,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: true,
    costInput: 0.075,
    costOutput: 0.3,
    status: 'beta',
    source: 'models.dev',
    canDisable: true,
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'qwen/qwen3.6-27b',
    label: 'Qwen3.6 27B',
    context: 131072,
    maxOutput: 16384,
    protocol: 'chat',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 0.6,
    costOutput: 3,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['none', 'default'],
  },
  {
    id: 'qwen/qwen3.8-27b',
    label: 'Qwen3.8 27B',
    context: 131042,
    maxOutput: 16384,
    protocol: 'chat',
    thinkingOnly: false,
    vision: true,
    tools: true,
    costInput: 0.8,
    costOutput: 4,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: ['none', 'default', 'low', 'medium', 'high'],
  },
  {
    id: 'whisper-large-v3',
    label: 'Whisper',
    context: 0,
    maxOutput: 0,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: null,
    costOutput: null,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
  {
    id: 'whisper-large-v3-turbo',
    label: 'Whisper Large V3 Turbo',
    context: 0,
    maxOutput: 0,
    protocol: 'chat',
    thinkingOnly: false,
    vision: false,
    tools: false,
    costInput: null,
    costOutput: null,
    status: null,
    source: 'models.dev',
    canDisable: true,
    efforts: [],
  },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = GROQ_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return GROQ_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return GROQ_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return GROQ_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
