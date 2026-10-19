/**
 * Model catalog for the google provider, generated from models.dev.
 *
 * DO NOT EDIT BY HAND: run
 *   node scripts/generate-model-catalog.mjs --provider google
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

export const GOOGLE_CATALOG: CatalogModel[] = [
  { id: 'deep-research-max-preview-04-2026', label: "Deep Research Max Preview (Apr-21-2026)", context: 131072, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 12, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'deep-research-preview-04-2026', label: "Deep Research Preview (Apr-21-2026)", context: 131072, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 12, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-2.5-computer-use-preview-10-2025', label: "Gemini 2.5 Computer Use Preview 10-2025", context: 128000, maxOutput: 64000, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1.25, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-2.5-flash', label: "Gemini 2.5 Flash", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 2.5, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-2.5-flash-image', label: "Nano Banana", context: 32768, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 0.3, costOutput: 30, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-2.5-flash-lite', label: "Gemini 2.5 Flash-Lite", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.1, costOutput: 0.4, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-2.5-flash-preview-tts', label: "Gemini 2.5 Flash Preview TTS", context: 8192, maxOutput: 16384, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 0.5, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-2.5-pro', label: "Gemini 2.5 Pro", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1.25, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-2.5-pro-preview-tts', label: "Gemini 2.5 Pro Preview TTS", context: 8192, maxOutput: 16384, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 1, costOutput: 20, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-3-flash-preview', label: "Gemini 3 Flash Preview", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.5, costOutput: 3, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-3-pro-image', label: "Nano Banana Pro", context: 65536, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 2, costOutput: 120, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'high'] },
  { id: 'gemini-3-pro-image-preview', label: "Nano Banana Pro", context: 131072, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 2, costOutput: 120, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-3.1-flash-image', label: "Nano Banana 2", context: 131072, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 0.5, costOutput: 60, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'high'] },
  { id: 'gemini-3.1-flash-image-preview', label: "Nano Banana 2", context: 65536, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 0.5, costOutput: 60, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'high'] },
  { id: 'gemini-3.1-flash-lite', label: "Gemini 3.1 Flash Lite", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.25, costOutput: 1.5, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-3.1-flash-lite-image', label: "Nano Banana 2 Lite", context: 65536, maxOutput: 4096, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.25, costOutput: 30, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'high'] },
  { id: 'gemini-3.1-flash-lite-preview', label: "Gemini 3.1 Flash Lite Preview", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.25, costOutput: 1.5, status: 'deprecated', source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-3.1-flash-live-preview', label: "Gemini 3.1 Flash Live Preview", context: 131072, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.75, costOutput: 4.5, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-3.1-flash-tts-preview', label: "Gemini 3.1 Flash TTS Preview", context: 8192, maxOutput: 16384, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 1, costOutput: 20, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-3.1-pro-preview', label: "Gemini 3.1 Pro Preview", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 12, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-3.1-pro-preview-customtools', label: "Gemini 3.1 Pro Preview Custom Tools", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 12, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-3.5-flash', label: "Gemini 3.5 Flash", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 1.5, costOutput: 9, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-3.5-flash-lite', label: "Gemini 3.5 Flash Lite", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 2.5, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-3.5-live-translate-preview', label: "Gemini 3.5 Live Translate Preview", context: 16384, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 3.5, costOutput: 21, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-3.6-flash', label: "Gemini 3.6 Flash", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.75, costOutput: 3.75, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-3.7-flash', label: "Gemini 3.7 Flash", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.75, costOutput: 3.75, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-3.8-flash', label: "Gemini 3.8 Flash", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.75, costOutput: 3.75, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-4-argon', label: "Gemini 4 Argon", context: 1048576, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 2, costOutput: 10, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-embedding-001', label: "Gemini Embedding 001", context: 2048, maxOutput: 1, protocol: 'chat', thinkingOnly: false, vision: false, tools: false, costInput: 0.15, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-embedding-2', label: "Gemini Embedding 2", context: 8192, maxOutput: 1, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 0.2, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemini-flash-latest', label: "Gemini Flash Latest", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.75, costOutput: 3.75, status: null, source: 'models.dev', canDisable: true, efforts: ['low', 'medium', 'high'] },
  { id: 'gemini-flash-lite-latest', label: "Gemini Flash-Lite Latest", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: 0.3, costOutput: 2.5, status: null, source: 'models.dev', canDisable: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { id: 'gemini-omni-flash-preview', label: "Gemini Omni Flash Preview", context: 131072, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 1.5, costOutput: 17.5, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemma-4-26b-a4b-it', label: "Gemma 4 26B A4B IT", context: 262144, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'gemma-4-31b-it', label: "Gemma 4 31B IT", context: 262144, maxOutput: 32768, protocol: 'chat', thinkingOnly: false, vision: true, tools: true, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'lyria-3-clip-preview', label: "Lyria 3 Clip Preview", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 0, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'lyria-3-pro-preview', label: "Lyria 3 Pro Preview", context: 1048576, maxOutput: 65536, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: 0, costOutput: 0, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'veo-3.1-fast-generate-preview', label: "Veo 3.1 fast", context: 480, maxOutput: 8192, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'veo-3.1-generate-preview', label: "Veo 3.1", context: 480, maxOutput: 8192, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: 'beta', source: 'models.dev', canDisable: true, efforts: [] },
  { id: 'veo-3.1-lite-generate-preview', label: "Veo 3.1 lite", context: 480, maxOutput: 8192, protocol: 'chat', thinkingOnly: false, vision: true, tools: false, costInput: null, costOutput: null, status: null, source: 'models.dev', canDisable: true, efforts: [] },
];

/** Protocol to use for a model, falling back to the id pattern for unknown ones. */
export function catalogProtocol(model: string): 'chat' | 'responses' | 'messages' {
  const entry = GOOGLE_CATALOG.find((item) => item.id === model);

  if (entry) {
    return entry.protocol;
  }

  return /^claude-/i.test(model) ? 'messages' : /^(gpt-|grok-)/i.test(model) ? 'responses' : 'chat';
}

/** True when the model cannot run with thinking disabled. */
export function catalogThinkingOnly(model: string): boolean {
  return GOOGLE_CATALOG.find((item) => item.id === model)?.thinkingOnly ?? false;
}

/** True when the model accepts `thinking: {type: 'disabled'}` at all. */
export function catalogCanDisableThinking(model: string): boolean {
  return GOOGLE_CATALOG.find((item) => item.id === model)?.canDisable ?? true;
}

/** Reasoning levels the model accepts; empty when it takes no effort parameter. */
export function catalogEfforts(model: string): string[] {
  return GOOGLE_CATALOG.find((item) => item.id === model)?.efforts ?? [];
}
