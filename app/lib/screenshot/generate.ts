/* Screenshot-to-code emits one complete HTML page, not a Bolt project or a trusted artifact. */
type Socket = Pick<WebSocket, 'addEventListener' | 'send' | 'close'>;

type GenerationOptions = {
  connect?: (url: string) => Socket;
  location?: Pick<Location, 'protocol' | 'host'>;
  onProgress?: (status: string) => void;
  signal?: AbortSignal;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CODE_LENGTH = 1_000_000;
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

export function generateScreenshotCode(image: string, options: GenerationOptions = {}): Promise<string> {
  validateScreenshot(image);

  const page = options.location ?? window.location;
  const scheme = page.protocol === 'https:' ? 'wss:' : 'ws:';

  const socket = (options.connect ?? ((url) => new WebSocket(url)))(
    `${scheme}//${page.host}/screenshot-api/generate-code`,
  );

  return new Promise((resolve, reject) => {
    const codes = new Map<number, string>();
    const completed = new Set<number>();

    let failure: string | undefined;
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

    socket.addEventListener('open', () => {
      if (settled) {
        return;
      }

      socket.send(
        JSON.stringify({
          generatedCodeConfig: 'html_tailwind',
          inputMode: 'image',
          generationType: 'create',
          prompt: { text: '', images: [image], videos: [] },
          isImageGenerationEnabled: false,
          isAssetExtractionEnabled: false,
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      if (settled) {
        return;
      }

      try {
        const response: unknown = JSON.parse((event as MessageEvent).data);

        if (!response || typeof response !== 'object' || !('type' in response) || typeof response.type !== 'string') {
          throw new Error('Invalid response');
        }

        const frame = response as { type: string; variantIndex?: unknown; value?: unknown };
        const index = frame.variantIndex;

        if (frame.type === 'error') {
          fail(typeof frame.value === 'string' ? frame.value : 'Screenshot service failed.');
          return;
        }

        if (frame.type === 'status' && typeof frame.value === 'string') {
          options.onProgress?.(frame.value);
        }

        if (
          (frame.type === 'setCode' || frame.type === 'variantComplete' || frame.type === 'variantError') &&
          (!Number.isSafeInteger(index) || (index as number) < 0)
        ) {
          throw new Error('Invalid response');
        }

        if (frame.type === 'setCode') {
          if (typeof frame.value !== 'string' || frame.value.length > MAX_CODE_LENGTH) {
            throw new Error('Invalid response');
          }

          codes.set(index as number, frame.value);
        }

        if (frame.type === 'variantComplete') {
          completed.add(index as number);
        }

        if (frame.type === 'variantError' && typeof frame.value === 'string') {
          failure = frame.value;
        }
      } catch {
        fail('Invalid screenshot service response. Nothing was imported.');
      }
    });
    socket.addEventListener('error', () => fail('Screenshot service connection failed.'));
    socket.addEventListener('close', (event) => {
      if (settled) {
        return;
      }

      if ((event as CloseEvent).code !== 1000) {
        fail(failure || 'Screenshot service connection closed unexpectedly.');
        return;
      }

      for (const index of completed) {
        const code = codes.get(index);

        if (!code) {
          continue;
        }

        try {
          const valid = validateGeneratedHtml(code);
          settled = true;
          cleanup();
          resolve(valid);

          return;
        } catch {
          // Another completed variant may contain valid HTML.
        }
      }
      fail(failure || 'Screenshot generation incomplete or unsafe. Nothing was imported.');
    });

    if (options.signal?.aborted) {
      abort();
    }
  });
}
