import type { ActionFunctionArgs } from 'react-router';
import { z } from 'zod';
import { getTrustedClientIP } from '~/lib/security';

/*
 * Design mockup generation for the screenshot-to-code flow.
 *
 * The user describes a page and gets several DESIGN mockups back; picking one feeds it
 * into the image-to-code pipeline. That first step needs a text-to-image model, which the
 * vendored screenshot-to-code backend does not provide: it generates the *assets inside*
 * a generated page (its `isImageGenerationEnabled` flag), not the page designs.
 *
 * The OpenAI key stays on the server: the browser posts a prompt and receives base64
 * images, never a credential.
 */
const requestSchema = z.object({
  prompt: z.string().min(3, 'Describe the page you want.').max(1500, 'Keep it under 1500 characters.'),
  count: z.number().int().min(1).max(4).default(3),
  model: z.enum(['gpt-image-1', 'dall-e-3']).default('gpt-image-1'),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
});

const BASE_INSTRUCTION =
  'A flat UI mockup of a web page, straight-on view, no perspective, no device frame, ' +
  'crisp vector shapes, readable placeholder text, white background, web design wireframe style.';

const DIRECTIONS = [
  'a clean, minimal, modern SaaS layout with generous whitespace and a single accent colour',
  'a bold, high-contrast editorial layout with strong typography and large imagery',
  'a warm, friendly product layout with rounded cards, soft shadows and an illustration',
  'a dense, data-oriented dashboard layout with cards, charts and a sidebar',
];

/** Per-IP throttle: image generation costs real money, so it must not be an open relay. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const hits = new Map<string, { count: number; resetAt: number }>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });

    return true;
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  entry.count += 1;

  return true;
}

function clientIp(request: Request, context: ActionFunctionArgs['context']): string {
  /*
   * Only identities the app can prove are trustworthy count. `x-real-ip`/`x-forwarded-for`
   * read directly are client-spoofable, so rotating a forged header bypassed the throttle on
   * this PAID endpoint entirely. `getTrustedClientIP` trusts `x-real-ip` only when the request
   * provably came through the local proxy; anything else shares one bucket.
   */
  return getTrustedClientIP(request, context) ?? 'unknown';
}

function buildPrompt(userPrompt: string, index: number): string {
  const direction = DIRECTIONS[index % DIRECTIONS.length];

  return `${BASE_INSTRUCTION} Content: ${userPrompt.trim()} Style direction: ${direction}.`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!allowed(clientIp(request, context))) {
    return Response.json(
      { error: 'Too many design requests. Wait a few minutes before trying again.' },
      { status: 429 },
    );
  }

  let parsed: z.infer<typeof requestSchema>;

  try {
    parsed = requestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
    }

    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const apiKey =
    (context?.cloudflare?.env as Record<string, any> | undefined)?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: 'Image generation is not configured on this server (no OpenAI key).' },
      { status: 503 },
    );
  }

  const baseUrl =
    (context?.cloudflare?.env as Record<string, any> | undefined)?.OPENAI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1';

  /*
   * One request per design, in parallel: each carries its own art direction so the results
   * are genuinely different proposals instead of N samples of the same idea.
   */
  const tasks = Array.from({ length: parsed.count }, async (_, index) => {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: parsed.model,
        prompt: buildPrompt(parsed.prompt, index),
        n: 1,
        size: parsed.size,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = body.data?.[0];

    if (first?.b64_json) {
      return first.b64_json;
    }

    /*
     * Some models answer with a URL instead of base64; fetch it so the client gets one
     * shape only.
     */
    if (first?.url) {
      const image = await fetch(first.url);

      if (!image.ok) {
        throw new Error(`Could not download the generated image (${image.status})`);
      }

      const buffer = await image.arrayBuffer();

      return Buffer.from(buffer).toString('base64');
    }

    throw new Error('OpenAI returned no image.');
  });

  const settled = await Promise.allSettled(tasks);

  const images = settled
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map((r) => r.value);

  if (images.length === 0) {
    const reason = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    const message = reason?.reason instanceof Error ? reason.reason.message : 'Design generation failed.';

    return Response.json({ error: message }, { status: 502 });
  }

  return Response.json({ images });
}
