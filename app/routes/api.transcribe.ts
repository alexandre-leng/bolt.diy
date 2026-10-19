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
 * a transcription service and answers `{ text }`. Two providers, tried in order:
 *   1. OpenAI (`/v1/audio/transcriptions`, `whisper-1`) when OPENAI_API_KEY is set,
 *   2. Groq (`/openai/v1/audio/transcriptions`, `whisper-large-v3-turbo`) when GROQ_API_KEY is set.
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

function normalizeMimeType(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}

/** Providers available for this deployment, in priority order. */
function availableProviders(env: Record<string, unknown>, cookieKeys: Record<string, string>): TranscriptionProvider[] {
  const providers: TranscriptionProvider[] = [];

  const openaiKey = cookieKeys.OpenAI || env.OPENAI_API_KEY;

  if (typeof openaiKey === 'string' && openaiKey.trim()) {
    providers.push({
      name: 'openai',
      endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      model: 'whisper-1',
      field: 'OPENAI_API_KEY',
    });
  }

  const groqKey = cookieKeys.Groq || env.GROQ_API_KEY;

  if (typeof groqKey === 'string' && groqKey.trim()) {
    providers.push({
      name: 'groq',
      endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
      model: 'whisper-large-v3-turbo',
      field: 'GROQ_API_KEY',
    });
  }

  return providers;
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

  const providers = availableProviders(env, cookieKeys);

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
