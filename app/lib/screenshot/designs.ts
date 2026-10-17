/*
 * Design generation: a text prompt becomes several page mockups, which the
 * screenshot-to-code pipeline then turns into code.
 *
 * This closes the loop the user actually wants: describe a page -> get N designs ->
 * pick one -> it becomes a site. It is deliberately separate from
 * `isImageGenerationEnabled` on the server, which generates the *assets inside* a
 * generated page (hero images, illustrations), not the page designs themselves.
 *
 * Runs server-side through the app's own route so the OpenAI key never reaches the
 * browser.
 */
export const DESIGN_COUNT = 3;

/** Models that return base64 image data through the Images API. */
export const DESIGN_MODELS = [
  { value: 'gpt-image-1', label: 'GPT Image (recommended)' },
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
  return ['Minimal', 'Bold', 'Friendly', 'Dense'][index % 4];
}

/**
 * Ask the app's own backend for N design mockups.
 *
 * The route is `/api/screenshot/designs`, served by the same auth guard as the rest of
 * the app: the OpenAI key stays on the server.
 */
export async function generateDesigns(request: DesignRequest): Promise<Design[]> {
  const prompt = validateDesignPrompt(request.prompt);
  const count = Math.min(Math.max(request.count ?? DESIGN_COUNT, 1), 4);

  const response = await fetch('/api/screenshot/designs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      count,
      model: request.model ?? 'gpt-image-1',
      size: request.size ?? '1024x1024',
    }),
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

    // Accept a bare base64 payload or a ready data URL.
    const image = value.startsWith('data:') ? value : `data:image/png;base64,${value}`;

    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      return;
    }

    designs.push({ image, direction: directionLabel(index) });
  });

  if (designs.length === 0) {
    throw new Error('Design generation returned no usable image.');
  }

  return designs;
}
