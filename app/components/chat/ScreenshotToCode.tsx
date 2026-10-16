import { useEffect, useRef, useState } from 'react';
import { generateScreenshotCode, validateScreenshot } from '~/lib/screenshot/generate';
import { importScreenshotHtml, validateImportableHtml } from '~/lib/screenshot/import';
import { workbenchStore } from '~/lib/stores/workbench';

type Props = {
  generate?: typeof generateScreenshotCode;
  importCode?: (code: string) => Promise<string>;
};

const readImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read screenshot.'));
    reader.readAsDataURL(file);
  });

export function ScreenshotToCode({
  generate = generateScreenshotCode,
  importCode = (code) => importScreenshotHtml(code, workbenchStore),
}: Props) {
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      controller.current?.abort();
    },
    [],
  );

  const select = (selected?: File) => {
    controller.current?.abort();
    setStatus('');
    setError('');
    setCode('');
    setFile(undefined);

    if (!selected) {
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 10 * 1024 * 1024) {
      setError('Choose a PNG, JPEG, or WebP screenshot under 10 MB.');
      return;
    }

    setFile(selected);
  };

  const start = async () => {
    if (!file || busy) {
      return;
    }

    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setCode('');
    setStatus('Reading screenshot...');

    try {
      const image = validateScreenshot(await readImage(file));

      if (abort.signal.aborted) {
        return;
      }

      const result = await generate(image, {
        signal: abort.signal,
        onProgress: (value) => {
          if (mounted.current && !abort.signal.aborted) {
            setStatus(value);
          }
        },
      });

      if (mounted.current && !abort.signal.aborted) {
        setCode(result);
        setStatus('Generation complete. Review the HTML before importing.');
      }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Generation failed.');
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  const importFile = async () => {
    if (!code || busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      validateImportableHtml(code);

      const path = await importCode(code);

      if (mounted.current) {
        setStatus(`Imported ${path}`);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Import failed.');
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-bolt-elements-borderColor p-3 text-sm text-bolt-elements-textPrimary">
      <label htmlFor="screenshot-image">Screenshot image</label>
      <input
        id="screenshot-image"
        aria-label="Screenshot image"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => select(event.target.files?.[0])}
        disabled={busy}
      />
      {file && <span>{file.name}</span>}
      <button type="button" disabled={!file || busy} onClick={() => void start()}>
        Generate HTML
      </button>
      {busy && (
        <button type="button" onClick={() => controller.current?.abort()}>
          Cancel generation
        </button>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {code && (
        <>
          <p>
            Review the generated HTML before importing. The preview is a static, scriptless rendering in an isolated
            frame; interactive JavaScript and Tailwind CDN scripts do not run here. The source is saved separately in
            Bolt only after you approve it.
          </p>
          <iframe
            title="Generated screenshot preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">${code}`}
            className="h-64 w-full rounded-md border border-bolt-elements-borderColor bg-white"
          />
          <textarea
            aria-label="Generated HTML source"
            readOnly
            value={code}
            className="w-full min-h-32 bg-transparent"
          />
          <button type="button" onClick={() => void importFile()} disabled={busy}>
            Import HTML into Bolt
          </button>
        </>
      )}
    </div>
  );
}
