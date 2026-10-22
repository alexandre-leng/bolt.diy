/*
 * Design generation: a text prompt becomes several page mockups, which the
 * screenshot-to-code pipeline then turns into code.
 *
 * This closes the loop the user actually wants: describe a page -> get N designs ->
 * pick one -> it becomes a site. It is deliberately separate from
 * `isImageGenerationEnabled` on the server, which generates the *assets inside* a
 * generated page (hero images, illustrations), not the page designs themselves.
 *
 * Runs server-side through the app's own route so the credential never reaches the
 * browser.
 */
export const DESIGN_COUNT = 3;

/** Models that return base64 image data through the Images API. */
export const DESIGN_MODELS = [
  { value: 'gpt-image-1', label: 'GPT Image (recommandé)' },
  { value: 'dall-e-3', label: 'DALL-E 3' },
] as const;

export type DesignModel = (typeof DESIGN_MODELS)[number]['value'];

export interface Design {
  /** Base64 data URL, ready to feed straight into the screenshot-to-code pipeline. */
  image: string;

  /** Short label describing the direction this variant took. */
  direction: string;
}

export interface DesignRequest {
  prompt: string;
  count?: number;
  model?: DesignModel;

  /** Portrait/landscape/square, mirrors the API's `size` parameter. */
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  signal?: AbortSignal;

  /**
   * Progressive mode: called as soon as each mockup is ready, so the panel fills in one tile at a
   * time instead of waiting for all of them. `index` is the art-direction slot.
   */
  onDesign?: (design: Design, index: number, done: number, total: number) => void;
}

/**
 * Distinct art directions, so the N results are genuinely different proposals rather
 * than N samples of the same idea. This is what makes "pick a design" useful.
 */
const DIRECTIONS = [
  'a clean, minimal, modern SaaS layout with generous whitespace and a single accent colour',
  'a bold, high-contrast editorial layout with strong typography and large imagery',
  'a warm, friendly product layout with rounded cards, soft shadows and an illustration',
  'a dense, data-oriented dashboard layout with cards, charts and a sidebar',
];

const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const BASE_INSTRUCTION =
  'A flat UI mockup of a web page, straight-on view, no perspective, no device frame, ' +
  'crisp vector shapes, readable placeholder text, white background, web design wireframe style.';

export function validateDesignPrompt(prompt: string): string {
  const trimmed = prompt.trim();

  if (trimmed.length < 3) {
    throw new Error('Describe the page you want (at least a few words).');
  }

  if (trimmed.length > 1500) {
    throw new Error('Keep the description under 1500 characters.');
  }

  return trimmed;
}

/** Compose the image prompt for one direction. Exported for testing. */
export function buildDesignPrompt(userPrompt: string, directionIndex: number): string {
  const direction = DIRECTIONS[directionIndex % DIRECTIONS.length];

  return `${BASE_INSTRUCTION} Content: ${userPrompt.trim()} Style direction: ${direction}.`;
}

function directionLabel(index: number): string {
  return ['Minimaliste', 'Affirmé', 'Chaleureux', 'Dense'][index % 4];
}

/**
 * Ask the app's own backend for N design mockups.
 *
 * The route is `/api/screenshot/designs`, served by the same auth guard as the rest of
 * the app: the OpenAI key stays on the server.
 */
/** One mockup: a single design, requested on its own so each has its own deadline. */
async function requestOne(args: {
  prompt: string;
  model: DesignModel;
  size: '1024x1024' | '1536x1024' | '1024x1536';
  index: number;
  signal?: AbortSignal;
}): Promise<Design> {
  const response = await fetch('/api/screenshot/designs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: args.prompt,
      count: 1,
      directionIndex: args.index,
      model: args.model,
      size: args.size,
    }),
    signal: args.signal,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;

    if (response.status === 502 || response.status === 504) {
      /* The gateway gives up before a subscription image finishes: say what to do, not the code. */
      detail = "le service image n'a pas répondu à temps. Réessayez, et si cela se répète, générez une seule maquette.";
    } else {
      try {
        const body = (await response.json()) as { error?: string };

        if (body?.error) {
          detail = body.error;
        }
      } catch {
        // keep the status text
      }
    }

    throw new Error(detail);
  }

  const body = (await response.json()) as { images?: unknown };
  const [first] = Array.isArray(body.images) ? body.images : [];

  if (typeof first !== 'string') {
    throw new Error("La génération n'a renvoyé aucune image.");
  }

  return toDesign(first, args.index);
}

/** Accept a bare base64 payload or a ready data URL; reject anything that is not an image. */
function toDesign(value: string, index: number): Design {
  const image = value.startsWith('data:') ? value : `data:image/png;base64,${value}`;

  if (!IMAGE_DATA_URL.test(image)) {
    throw new Error("La génération n'a renvoyé aucune image exploitable.");
  }

  return { image, direction: directionLabel(index) };
}

/*
 * Each mockup is requested on its own, so the panel can show the first one while the others are
 * still being drawn. Measured on this host: one subscription image takes 30-56 s, and a single
 * batched call for three exceeded the gateway budget and surfaced as a bare `HTTP 502`.
 *
 * Results therefore arrive out of order; `onDesign` carries the direction index so the caller can
 * place each mockup in its own slot.
 */
export async function generateDesigns(request: DesignRequest): Promise<Design[]> {
  const prompt = validateDesignPrompt(request.prompt);
  const count = Math.min(Math.max(request.count ?? DESIGN_COUNT, 1), 4);
  const model = request.model ?? 'gpt-image-1';
  const size = request.size ?? '1024x1024';

  if (request.onDesign) {
    const slots: Array<Design | undefined> = [];

    for (let index = 0; index < count; index += 1) {
      const design = await requestOne({ prompt, model, size, index, signal: request.signal });

      slots[index] = design;
      request.onDesign(design, index, slots.filter(Boolean).length, count);
    }

    return slots.filter((slot): slot is Design => Boolean(slot));
  }

  const response = await fetch('/api/screenshot/designs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, count, model, size }),
    signal: request.signal,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;

    try {
      const body = (await response.json()) as { error?: string };

      if (body?.error) {
        detail = body.error;
      }
    } catch {
      // keep the status text
    }

    throw new Error(`Design generation failed: ${detail}`);
  }

  const body = (await response.json()) as { images?: unknown };

  if (!Array.isArray(body.images) || body.images.length === 0) {
    throw new Error('Design generation returned no image.');
  }

  const designs: Design[] = [];

  body.images.forEach((value, index) => {
    if (typeof value !== 'string') {
      return;
    }

    try {
      designs.push(toDesign(value, index));
    } catch {
      // skip a payload that is not an image
    }
  });

  if (designs.length === 0) {
    throw new Error('Design generation returned no usable image.');
  }

  return designs;
}
