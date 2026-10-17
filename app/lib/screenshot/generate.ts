/*
 * Client for the screenshot-to-code backend.
 *
 * The backend streams a generation as a sequence of typed frames — not a single string —
 * and produces SEVERAL variants for one image (NUM_VARIANTS on the server, 4 today). The
 * previous version of this module collapsed all of that into one resolved string, so the
 * UI could not show progress beyond a generic status, could not surface the model's
 * reasoning, and threw away every variant but the last completed one.
 *
 * This module keeps the whole stream: it reports every frame as it arrives and resolves
 * with ALL valid variants, ordered by index.
 */
type Socket = Pick<WebSocket, 'addEventListener' | 'send' | 'close'>;

/** Stacks the backend accepts (`Stack` in backend/prompts/prompt_types.py). */
export const STACKS = [
  { value: 'html_tailwind', label: 'HTML + Tailwind' },
  { value: 'html_css', label: 'HTML + CSS' },
  { value: 'react_tailwind', label: 'React + Tailwind' },
  { value: 'vue_tailwind', label: 'Vue + Tailwind' },
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'ionic_tailwind', label: 'Ionic + Tailwind' },
] as const;

/** Input modes the backend accepts (`InputMode` in backend/custom_types.py). */
export const INPUT_MODES = ['image', 'video', 'text'] as const;

export type Stack = (typeof STACKS)[number]['value'];
export type InputMode = (typeof INPUT_MODES)[number];
export type GenerationType = 'create' | 'update';

/** One generated variant, already validated. */
export interface Variant {
  index: number;
  code: string;
}

/**
 * Every frame the backend can emit, mapped to what the UI needs.
 *
 * `thinking` / `toolStart` / `toolResult` / `assistant` are progress signals: without them
 * a generation that runs for minutes looks frozen.
 */
export type StreamEvent =
  | { kind: 'status'; text: string }
  | { kind: 'variantCount'; count: number }
  | { kind: 'thinking'; text: string }
  | { kind: 'toolStart'; name: string }
  | { kind: 'toolResult'; text: string }
  | { kind: 'setCode'; variantIndex: number; length: number }
  | { kind: 'assistant'; text: string }
  | { kind: 'variantComplete'; variantIndex: number }
  | { kind: 'variantError'; variantIndex: number; message: string };

export interface GenerationOptions {
  stack?: Stack;
  inputMode?: InputMode;
  generationType?: GenerationType;

  /** Text prompt, required for `text` input and for `update`. */
  text?: string;

  /** Extra images beyond the first (the backend accepts a list). */
  images?: string[];
  videos?: string[];

  /** Ask the backend to generate image assets for the page. */
  shouldGenerateImages?: boolean;
  shouldExtractAssets?: boolean;

  /** Name of a saved design system to follow. */
  designSystem?: string;
  connect?: (url: string) => Socket;
  location?: Pick<Location, 'protocol' | 'host'>;

  /** Called for every frame, in arrival order. */
  onEvent?: (event: StreamEvent) => void;

  /** Kept for callers that only care about a human-readable line. */
  onProgress?: (status: string) => void;
  signal?: AbortSignal;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CODE_LENGTH = 1_000_000;
const MAX_VARIANTS = 8;
const VALID_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function validateScreenshot(image: string) {
  const match = VALID_IMAGE.exec(image);

  if (!match || match[1].length * 0.75 > MAX_IMAGE_BYTES) {
    throw new Error('Choose a PNG, JPEG, or WebP screenshot under 10 MB.');
  }

  return image;
}

/** Validate envelope/size only. HTML is untrusted source; never render or execute it in Bolt's origin. */
export function validateGeneratedHtml(value: string): string {
  if (
    !value ||
    value.length > MAX_CODE_LENGTH ||
    !/^\s*<!doctype html\s*>/i.test(value) ||
    !/<html\b[^>]*>[\s\S]*<\/html\s*>\s*$/i.test(value) ||
    !/<body\b[^>]*>/i.test(value)
  ) {
    throw new Error('Generated code is not a complete HTML page. Nothing was imported.');
  }

  return value;
}

/** Map one raw server frame onto a StreamEvent, or undefined for frames we ignore. */
function toEvent(frame: { type: string; variantIndex?: unknown; value?: unknown }): StreamEvent | undefined {
  const index = Number.isSafeInteger(frame.variantIndex) ? (frame.variantIndex as number) : undefined;

  switch (frame.type) {
    case 'status':
      return typeof frame.value === 'string' ? { kind: 'status', text: frame.value } : undefined;

    case 'variantCount':
      return typeof frame.value === 'number' ? { kind: 'variantCount', count: frame.value } : undefined;

    case 'thinking':
      return typeof frame.value === 'string' ? { kind: 'thinking', text: frame.value } : undefined;

    case 'assistant':
      return typeof frame.value === 'string' ? { kind: 'assistant', text: frame.value } : undefined;

    case 'toolStart':
      return typeof frame.value === 'string' ? { kind: 'toolStart', name: frame.value } : undefined;

    case 'toolResult':
      return typeof frame.value === 'string' ? { kind: 'toolResult', text: frame.value } : undefined;

    case 'variantComplete':
      return index === undefined ? undefined : { kind: 'variantComplete', variantIndex: index };

    case 'variantError':
      return index === undefined
        ? undefined
        : { kind: 'variantError', variantIndex: index, message: typeof frame.value === 'string' ? frame.value : '' };

    default:
      return undefined;
  }
}

/**
 * Generate code from one image. Resolves with every valid variant, ordered by index.
 *
 * For a text-only generation use `generateMany([], { inputMode: 'text', text })`: this
 * entry point takes an image by definition and validates it.
 */
export function generateScreenshotCode(image: string, options: GenerationOptions = {}): Promise<Variant[]> {
  validateScreenshot(image);

  return generateMany([image], options);
}

/**
 * Generate code from one or more images and/or a text prompt.
 *
 * Resolves with EVERY completed variant whose HTML passes validation, ordered by variant
 * index — the caller shows them side by side and lets the user pick. A variant that fails
 * validation is skipped rather than failing the whole generation, because the backend
 * routinely finishes a partial variant last.
 */
export function generateMany(images: string[], options: GenerationOptions = {}): Promise<Variant[]> {
  const inputMode = options.inputMode ?? 'image';

  images.forEach(validateScreenshot);

  if (inputMode !== 'text' && images.length === 0) {
    throw new Error('Choose a PNG, JPEG, or WebP screenshot.');
  }

  if (inputMode === 'text' && !options.text?.trim()) {
    throw new Error('Type a description of the page you want.');
  }

  const page = options.location ?? window.location;
  const scheme = page.protocol === 'https:' ? 'wss:' : 'ws:';

  const socket = (options.connect ?? ((url) => new WebSocket(url)))(
    `${scheme}//${page.host}/screenshot-api/generate-code`,
  );

  return new Promise((resolve, reject) => {
    const codes = new Map<number, string>();
    const completed = new Set<number>();
    const failures: string[] = [];

    let settled = false;

    const cleanup = () => options.signal?.removeEventListener('abort', abort);

    const fail = (message: string) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.close();
      reject(new Error(message));
    };

    const abort = () => fail('Screenshot generation cancelled.');
    options.signal?.addEventListener('abort', abort, { once: true });

    const emit = (event: StreamEvent) => {
      options.onEvent?.(event);

      if (event.kind === 'status') {
        options.onProgress?.(event.text);
      }
    };

    socket.addEventListener('open', () => {
      if (settled) {
        return;
      }

      socket.send(
        JSON.stringify({
          generatedCodeConfig: options.stack ?? 'html_tailwind',
          inputMode,
          generationType: options.generationType ?? 'create',
          prompt: {
            text: options.text ?? '',
            images: [...images, ...(options.images ?? [])],
            videos: options.videos ?? [],
          },
          isImageGenerationEnabled: options.shouldGenerateImages ?? false,
          isAssetExtractionEnabled: options.shouldExtractAssets ?? false,
          ...(options.designSystem ? { designSystem: options.designSystem } : {}),
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      if (settled) {
        return;
      }

      let frame: { type: string; variantIndex?: unknown; value?: unknown };

      try {
        const parsed: unknown = JSON.parse((event as MessageEvent).data);

        if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || typeof parsed.type !== 'string') {
          throw new Error('Invalid response');
        }

        frame = parsed as typeof frame;
      } catch {
        fail('Invalid screenshot service response. Nothing was imported.');

        return;
      }

      if (frame.type === 'error') {
        fail(typeof frame.value === 'string' ? frame.value : 'Screenshot service failed.');

        return;
      }

      if (frame.type === 'setCode') {
        const index = frame.variantIndex;

        if (typeof frame.value !== 'string' || frame.value.length > MAX_CODE_LENGTH) {
          fail('Invalid screenshot service response. Nothing was imported.');

          return;
        }

        if (Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < MAX_VARIANTS) {
          codes.set(index as number, frame.value);
          emit({ kind: 'setCode', variantIndex: index as number, length: frame.value.length });
        }

        return;
      }

      if (frame.type === 'variantError' && typeof frame.value === 'string') {
        failures.push(frame.value);
      }

      if (frame.type === 'variantComplete' && Number.isSafeInteger(frame.variantIndex)) {
        const index = frame.variantIndex as number;

        if (index >= 0 && index < MAX_VARIANTS) {
          completed.add(index);
        }
      }

      const mapped = toEvent(frame);

      if (mapped) {
        emit(mapped);
      }
    });

    socket.addEventListener('error', () => fail('Screenshot service connection failed.'));
    socket.addEventListener('close', (event) => {
      if (settled) {
        return;
      }

      if ((event as CloseEvent).code !== 1000) {
        fail(failures[0] || 'Screenshot service connection closed unexpectedly.');

        return;
      }

      const collect = (indices: number[]): Variant[] => {
        const variants: Variant[] = [];

        for (const index of indices) {
          const code = codes.get(index);

          if (!code) {
            continue;
          }

          try {
            variants.push({ index, code: validateGeneratedHtml(code) });
          } catch {
            // Skip this variant only: another completed one may be valid.
          }
        }

        return variants;
      };

      let variants = collect([...completed].sort((a, b) => a - b));

      // Some backends close without a variantComplete frame; fall back to what arrived.
      if (variants.length === 0) {
        variants = collect([...codes.keys()].sort((a, b) => a - b));
      }

      if (variants.length === 0) {
        fail(failures[0] || 'Screenshot generation incomplete or unsafe. Nothing was imported.');

        return;
      }

      settled = true;
      cleanup();
      resolve(variants);
    });

    if (options.signal?.aborted) {
      abort();
    }
  });
}
