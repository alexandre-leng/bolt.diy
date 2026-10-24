import type { ActionFunctionArgs } from 'react-router';
import { z } from 'zod';
import { CODEX_BASE_URL, codexAuth, codexHeaders } from '~/lib/.server/codex-oauth';
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
const DIRECTIONS = [
  'a clean, minimal, modern SaaS layout with generous whitespace and a single accent colour',
  'a bold, high-contrast editorial layout with strong typography and large imagery',
  'a warm, friendly product layout with rounded cards, soft shadows and an illustration',
  'a dense, data-oriented dashboard layout with cards, charts and a sidebar',
];

const requestSchema = z.object({
  prompt: z.string().min(3, 'Describe the page you want.').max(1500, 'Keep it under 1500 characters.'),
  count: z.number().int().min(1).max(4).default(3),

  /*
   * Which direction slot this request starts at. The client asks for ONE mockup per call (so each
   * gets its own deadline), so without this every call rebuilt the prompt from slot 0 and three
   * "different" mockups came back as three tries at the same direction.
   */
  directionIndex: z
    .number()
    .int()
    .min(0)
    .max(DIRECTIONS.length - 1)
    .default(0),
  model: z.enum(['gpt-image-1', 'dall-e-3']).default('gpt-image-1'),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
});

const BASE_INSTRUCTION =
  'A flat UI mockup of a web page, straight-on view, no perspective, no device frame, ' +
  'crisp vector shapes, readable placeholder text, white background, web design wireframe style.';

/** Per-IP throttle: image generation costs real money, so it must not be an open relay. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;

/** One image takes 30-56 s on the subscription backend; bound it well above that. */
const IMAGE_TIMEOUT_MS = 120_000;
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

/*
 * Ask the screenshot-to-code service for the mockups. It owns the OAuth session and the
 * rotating refresh token; this Worker only forwards a prompt and receives base64 images.
 *
 * Returns null (rather than throwing) when the service is unreachable or not configured, so
 * the caller can fall back to its own credentials. A service that answers with an error is
 * surfaced verbatim: that message names the real problem (expired login, quota) instead of a
 * generic "not configured".
 */
async function requestDesignsFromService(args: {
  url: string;
  token: string;
  parsed: z.infer<typeof requestSchema>;
}): Promise<Response | null> {
  const { url, token, parsed } = args;

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/internal/designs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ prompt: parsed.prompt, count: parsed.count, directionIndex: parsed.directionIndex }),
      signal: AbortSignal.timeout(180_000),
    });

    if (response.ok) {
      const body = (await response.json()) as { images?: string[]; model?: string };

      if (Array.isArray(body.images) && body.images.length > 0) {
        return Response.json({ images: body.images, model: body.model ?? parsed.model });
      }

      return Response.json({ error: 'The image service returned no mockup.' }, { status: 502 });
    }

    if (response.status === 503 || response.status === 502) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };

      return Response.json(
        { error: body.detail ?? `Image service failed (HTTP ${response.status}).` },
        { status: 503 },
      );
    }

    /* 401 on our shared token is a deployment bug, not a user-facing condition. */
    return Response.json({ error: `Image service refused the request (HTTP ${response.status}).` }, { status: 502 });
  } catch {
    /* Unreachable service: let the caller try its own credentials. */
    return null;
  }
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

    /* Each mockup must own a DISTINCT direction: wrapping would repeat the first one. */
    if (parsed.directionIndex + parsed.count > DIRECTIONS.length) {
      return Response.json(
        {
          error: `Demandez au plus ${DIRECTIONS.length - parsed.directionIndex} maquette(s) à partir de cette direction.`,
        },
        { status: 400 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
    }

    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  /*
   * Two credentials, tried in this order:
   *  1. the ChatGPT/Codex OAuth session (`codex login`), which bills the ChatGPT plan and lives
   *     on a different backend (`chatgpt.com/backend-api/codex`), not `api.openai.com`;
   *  2. a platform `OPENAI_API_KEY`, if the deployment happens to carry one.
   * Neither present is a real configuration error, and the message says so instead of
   * pretending the feature is broken.
   */
  const session = await codexAuth();

  const apiKey =
    (context?.cloudflare?.env as Record<string, any> | undefined)?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

  /*
   * A Worker has NO filesystem: `codexAuth()` above exists for the Node-run routes, but inside
   * workerd `existsSync()` answers false and `readFileSync()` throws even when auth.json is
   * mounted, so it always returns null here. The OAuth session is therefore owned by the
   * screenshot-to-code service, which runs on Node, refreshes the rotating token and exposes
   * `POST /api/internal/designs`. This Worker proxies to it over the host gateway; the
   * subscription is still what pays, and no OpenAI key exists anywhere.
   */
  const env = (context?.cloudflare?.env as Record<string, any> | undefined) ?? {};
  const serviceUrl = env.DESIGN_API_URL || process.env.DESIGN_API_URL;
  const serviceToken = env.DESIGN_API_INTERNAL_TOKEN || process.env.DESIGN_API_INTERNAL_TOKEN;

  if (serviceUrl && serviceToken) {
    const designs = await requestDesignsFromService({ url: serviceUrl, token: serviceToken, parsed });

    if (designs) {
      return designs;
    }
  }

  if (!session && !apiKey) {
    return Response.json(
      {
        error:
          'Image generation is not configured on this server: the screenshot-to-code service has no ChatGPT OAuth session, and no OpenAI API key is set.',
      },
      { status: 503 },
    );
  }

  const openaiEnv = (context?.cloudflare?.env as Record<string, any> | undefined) ?? {};

  const baseUrl = session
    ? `${CODEX_BASE_URL}/images/generations`
    : `${openaiEnv.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/images/generations`;

  const authHeaders: Record<string, string> = session
    ? codexHeaders(session)
    : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  /*
   * Sequential, with a per-image deadline. Measured on this host: ONE subscription image takes
   * 30-56 s, so three in PARALLEL ran past the gateway's ~30 s budget and the browser showed a bare
   * `HTTP 502` while this route was still working. A single request per design keeps each one
   * inside its own timeout and stops a failure from paying for the other two.
   */
  const images: string[] = [];

  let lastError = '';

  for (let index = 0; index < parsed.count; index += 1) {
    try {
      images.push(
        await generateOne(baseUrl, authHeaders, buildPrompt(parsed.prompt, parsed.directionIndex + index), parsed),
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Design generation failed.';
    }
  }

  if (images.length === 0) {
    return Response.json({ error: lastError }, { status: 502 });
  }

  return Response.json({ images });
}

/** One image, bounded in time: a provider that never answers must not hold the request open. */
async function generateOne(
  baseUrl: string,
  headers: Record<string, string>,
  prompt: string,
  parsed: z.infer<typeof requestSchema>,
): Promise<string> {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: parsed.model, prompt, n: 1, size: parsed.size }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    throw new Error(`Image provider answered ${response.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = body.data?.[0];

  if (first?.b64_json) {
    return first.b64_json;
  }

  /* Some models answer with a URL instead of base64; fetch it so the client gets one shape. */
  if (first?.url) {
    const image = await fetch(first.url);

    if (!image.ok) {
      throw new Error(`Could not download the generated image (${image.status})`);
    }

    return Buffer.from(await image.arrayBuffer()).toString('base64');
  }

  throw new Error('The image provider returned no image.');
}
