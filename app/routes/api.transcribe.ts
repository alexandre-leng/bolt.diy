import type { ActionFunctionArgs } from 'react-router';
import { ApiError, PayloadTooLargeError, toApiErrorResponse } from '~/lib/.server/api/errors';
import { readBodyBytes } from '~/lib/.server/api/read-body';
import { getApiKeysFromCookie } from '~/lib/api/cookies';
import { MAX_DICTATION_BYTES, isDictationLanguage, whisperLanguage } from '~/lib/dictation';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

/*
 * Dictation for browsers without the Web Speech API.
 *
 * The composer records with MediaRecorder and posts the clip here; this route forwards it to
 * a transcription service and answers `{ text }`. The service and the model come from the
 * Voice settings panel (`provider` and `model` form fields), both checked against
 * ALLOWED_MODELS; the other configured provider is kept as a fallback when the chosen one
 * refuses the key.
 * Both need a file with a NAME and a supported container, both bill (or quota) per minute,
 * so the clip is bounded before a single byte leaves the server.
 *
 * The key never reaches the client, and no provider message is forwarded verbatim: they can
 * echo request URLs. The client gets a `code` it maps to a sentence (see `~/lib/dictation`).
 */

export const action = withSecurity(transcribeAction, { allowedMethods: ['POST'] });

const logger = createScopedLogger('api.transcribe');

/** Formats the transcription services accept; anything else is refused before the upload. */
const ACCEPTED_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
]);

interface TranscriptionProvider {
  name: 'openai' | 'groq';
  endpoint: string;
  model: string;
  field: string;
}

/*
 * Models this route will call, and nothing else.
 *
 * The model is a client-supplied string, so it is checked against a list rather than trusted: an
 * arbitrary value would be a free-text field in a billable API call. Every entry answered a real
 * request on 2026-10-19; the settings panel offers exactly these (see `~/lib/dictation-config`).
 */
const ALLOWED_MODELS: Record<TranscriptionProvider['name'], string[]> = {
  openai: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
  groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
};

const DEFAULT_MODELS: Record<TranscriptionProvider['name'], string> = {
  openai: 'gpt-4o-mini-transcribe',
  groq: 'whisper-large-v3-turbo',
};

/**
 * The model to ask for: the client's choice when it is one we support for that provider,
 * otherwise the provider's default. Never an arbitrary string.
 */
function resolveModel(provider: TranscriptionProvider['name'], requested: unknown): string {
  return typeof requested === 'string' && ALLOWED_MODELS[provider].includes(requested)
    ? requested
    : DEFAULT_MODELS[provider];
}

function normalizeMimeType(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}

/**
 * Providers available for this deployment, preferred one first.
 *
 * `preferred` comes from the settings panel. The other provider is kept as a fallback so a key
 * that expired (401) still produces a transcript through the service that works, rather than an
 * error the user cannot act on.
 */
function availableProviders(
  env: Record<string, unknown>,
  cookieKeys: Record<string, string>,
  requestedModel: unknown,
  preferred: 'openai' | 'groq',
): TranscriptionProvider[] {
  const catalogue: TranscriptionProvider[] = [];

  const openaiKey = cookieKeys.OpenAI || env.OPENAI_API_KEY;

  if (typeof openaiKey === 'string' && openaiKey.trim()) {
    catalogue.push({
      name: 'openai',
      endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      model: resolveModel('openai', requestedModel),
      field: 'OPENAI_API_KEY',
    });
  }

  const groqKey = cookieKeys.Groq || env.GROQ_API_KEY;

  if (typeof groqKey === 'string' && groqKey.trim()) {
    catalogue.push({
      name: 'groq',
      endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
      model: resolveModel('groq', requestedModel),
      field: 'GROQ_API_KEY',
    });
  }

  return [
    ...catalogue.filter((provider) => provider.name === preferred),
    ...catalogue.filter((provider) => provider.name !== preferred),
  ];
}

function keyFor(provider: TranscriptionProvider, env: Record<string, unknown>, cookieKeys: Record<string, string>) {
  const cookieKey = cookieKeys[provider.name === 'openai' ? 'OpenAI' : 'Groq'];

  if (typeof cookieKey === 'string' && cookieKey.trim()) {
    return cookieKey.trim();
  }

  const value = env[provider.field];

  return typeof value === 'string' ? value.trim() : '';
}

/*
 * Not exported: a route module may only export `action`/`loader` when it imports server-only
 * code (React Router strips the rest for the client bundle and refuses the build otherwise).
 */
async function transcribeAction({ context, request }: ActionFunctionArgs) {
  const env = ((context as unknown as { cloudflare?: { env?: Record<string, unknown> } })?.cloudflare?.env ??
    {}) as Record<string, unknown>;

  const cookieKeys = getApiKeysFromCookie(request.headers.get('Cookie'));

  let form: FormData;

  try {
    // Bounded before parsing: an oversized upload is refused, not buffered.
    const body = await readBodyBytes(request, { maxBytes: MAX_DICTATION_BYTES + 1024 });

    form = await new Response(new Uint8Array(body).buffer as ArrayBuffer, {
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' },
    }).formData();
  } catch (error) {
    /*
     * A body over budget is a 413 the client can explain; anything else (truncated multipart,
     * no boundary) is a malformed request and must not claim "too long".
     */
    if (error instanceof PayloadTooLargeError) {
      return toApiErrorResponse(
        new ApiError('L’enregistrement est trop volumineux.', { status: 413, code: 'too-long', isRetryable: false }),
        'transcribe',
      );
    }

    logger.warn('Rejected a dictation body that is not a readable multipart form');

    return toApiErrorResponse(
      new ApiError('Requête de dictée invalide.', { status: 400, code: 'provider-refused', isRetryable: false }),
      'transcribe',
    );
  }

  const file = form.get('file');
  const languageRaw = form.get('language');
  const modelRaw = form.get('model');
  const providerRaw = form.get('provider');
  const preferred: 'openai' | 'groq' = providerRaw === 'groq' ? 'groq' : 'openai';

  if (!(file instanceof File) || file.size === 0) {
    return toApiErrorResponse(
      new ApiError('Aucun audio reçu.', { status: 400, code: 'provider-refused', isRetryable: false }),
      'transcribe',
    );
  }

  if (file.size > MAX_DICTATION_BYTES) {
    return toApiErrorResponse(
      new ApiError('L’enregistrement est trop volumineux.', { status: 413, code: 'too-long', isRetryable: false }),
      'transcribe',
    );
  }

  /*
   * `application/octet-stream` is what some MediaRecorder implementations report. The provider
   * sniffs the container, but a wrong or missing type is the one case where it answers 400, so
   * the file is re-labelled from its extension rather than refused.
   */
  const mimeType = normalizeMimeType(file.type || 'application/octet-stream');

  if (mimeType !== 'application/octet-stream' && !ACCEPTED_TYPES.has(mimeType) && !ACCEPTED_TYPES.has(file.type)) {
    return toApiErrorResponse(
      new ApiError('Format audio non pris en charge.', { status: 400, code: 'provider-refused', isRetryable: false }),
      'transcribe',
    );
  }

  const providers = availableProviders(env, cookieKeys, modelRaw, preferred);

  if (providers.length === 0) {
    logger.warn('Dictation requested but no transcription key is configured');

    return toApiErrorResponse(
      new ApiError('Transcription indisponible: aucune clé configurée.', {
        status: 503,
        code: 'key-missing',
        isRetryable: false,
      }),
      'transcribe',
    );
  }

  const language = typeof languageRaw === 'string' && isDictationLanguage(languageRaw) ? languageRaw : 'fr-FR';

  let lastFailure: ApiError | null = null;

  for (const provider of providers) {
    const key = keyFor(provider, env, cookieKeys);

    if (!key) {
      continue;
    }

    const outbound = new FormData();
    outbound.append('file', file, file.name || 'dictation.webm');
    outbound.append('model', provider.model);
    outbound.append('language', whisperLanguage(language));
    outbound.append('response_format', 'json');

    try {
      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: outbound,
        signal: request.signal,
      });

      if (response.ok) {
        const payload = (await response.json()) as { text?: unknown };
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';

        logger.info(`Dictation transcribed by ${provider.name} (${file.size} bytes)`);

        return Response.json({ text }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const detail = await response.text().catch(() => '');
      logger.warn(`${provider.name} refused the dictation: ${response.status} ${detail.slice(0, 200)}`);

      /*
       * 401/403 is this provider's key problem: try the next one. 429 and 5xx are transient for
       * this one too. A 400 means the audio itself is unusable, which no provider would fix.
       */
      lastFailure = new ApiError('La transcription a échoué.', {
        status: response.status === 401 || response.status === 403 ? 503 : response.status === 429 ? 429 : 400,
        code:
          response.status === 401 || response.status === 403
            ? 'key-missing'
            : response.status === 429
              ? 'quota'
              : 'provider-refused',
        isRetryable: response.status === 429 || response.status >= 500,
        provider: provider.name,
      });

      if (response.status === 400) {
        return toApiErrorResponse(lastFailure, provider.name);
      }
    } catch (error) {
      if (request.signal.aborted) {
        return toApiErrorResponse(error, provider.name);
      }

      logger.warn(`${provider.name} transcription request failed`);
      lastFailure = new ApiError('La transcription a échoué (réseau).', {
        status: 502,
        code: 'network',
        isRetryable: true,
        provider: provider.name,
      });
    }
  }

  if (lastFailure) {
    return toApiErrorResponse(lastFailure, 'transcribe');
  }

  return toApiErrorResponse(
    new ApiError('Aucune transcription disponible.', { status: 503, code: 'key-missing', isRetryable: false }),
    'transcribe',
  );
}
