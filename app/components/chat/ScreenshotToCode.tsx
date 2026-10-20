import { useEffect, useRef, useState } from 'react';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';
import { generateDesigns, validateDesignPrompt, DESIGN_COUNT, type Design } from '~/lib/screenshot/designs';
import {
  generateScreenshotCode,
  STACKS,
  validateScreenshot,
  type Stack,
  type StreamEvent,
  type Variant,
} from '~/lib/screenshot/generate';
import { importScreenshotHtml, validateImportableHtml } from '~/lib/screenshot/import';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

type Props = {
  generate?: typeof generateScreenshotCode;
  importCode?: (code: string) => Promise<string>;

  /** Text-to-image step: a prompt becomes page mockups to choose from. */
  designFor?: typeof generateDesigns;
};

/** Cap on the streamed progress lines kept in the panel, so a long run cannot grow forever. */
const MAX_LOG_LINES = 60;

/** The two ways into a project. Chosen with a visible card, not a hidden dropdown. */
type Mode = 'design' | 'screenshot';

const MODES: Array<{ value: Mode; icon: string; title: string; hint: string }> = [
  {
    value: 'design',
    icon: 'i-ph:sparkle-duotone',
    title: 'Generate a design',
    hint: 'Describe the page, get mockups, pick one',
  },
  {
    value: 'screenshot',
    icon: 'i-ph:image-duotone',
    title: 'Use an image',
    hint: 'Turn a screenshot or exported mockup into code',
  },
];

const readImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read screenshot.'));
    reader.readAsDataURL(file);
  });

/** Convert a generated design (data URL) into a File so both paths share one reader. */
async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return new File([blob], name, { type: blob.type || 'image/png' });
}

/**
 * Turn one stream frame into a line for the progress log.
 *
 * The backend streams far more than a status string — it reports its reasoning, the tools
 * it runs and how many variants it will produce. Showing those is what keeps a generation
 * that takes minutes from looking frozen.
 */
function describeEvent(event: StreamEvent): string | undefined {
  switch (event.kind) {
    case 'status':
      return event.text;

    case 'variantCount':
      return `Generating ${event.count} version${event.count === 1 ? '' : 's'}...`;

    case 'toolStart':
      return `Running ${event.name}...`;

    case 'thinking': {
      const text = event.text.trim();

      return text ? `Thinking: ${text.slice(0, 120)}` : undefined;
    }

    case 'assistant': {
      const text = event.text.trim();

      return text ? text.slice(0, 120) : undefined;
    }

    default:
      return undefined;
  }
}

export function ScreenshotToCode({
  generate = generateScreenshotCode,
  importCode = (code) => importScreenshotHtml(code, workbenchStore),
  designFor = generateDesigns,
}: Props) {
  const [mode, setMode] = useState<Mode>('design');
  const [prompt, setPrompt] = useState('');
  const [designs, setDesigns] = useState<Design[]>([]);
  const [chosenDesign, setChosenDesign] = useState(0);

  const [file, setFile] = useState<File>();
  const [stack, setStack] = useState<Stack>('html_tailwind');
  const [status, setStatus] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selected, setSelected] = useState(0);
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

  const pushLog = (line: string) => {
    setLog((current) => [...current, line].slice(-MAX_LOG_LINES));
  };

  const reset = () => {
    controller.current?.abort();
    setStatus('');
    setLog([]);
    setError('');
    setVariants([]);
    setSelected(0);
  };

  const switchMode = (next: Mode) => {
    if (next === mode || busy) {
      return;
    }

    reset();
    setMode(next);
    setDesigns([]);
    setChosenDesign(0);
    setFile(undefined);
  };

  const select = (selectedFile?: File) => {
    reset();
    setFile(undefined);

    if (!selectedFile) {
      return;
    }

    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(selectedFile.type) ||
      selectedFile.size > 10 * 1024 * 1024
    ) {
      setError('Choose a PNG, JPEG, or WebP screenshot under 10 MB.');

      return;
    }

    setFile(selectedFile);
  };

  /** Shared pipeline call, so both modes produce identical results. */
  const runGeneration = (image: string, abort: AbortController) =>
    generate(image, {
      stack,
      signal: abort.signal,
      onEvent: (event) => {
        if (!mounted.current || abort.signal.aborted) {
          return;
        }

        const line = describeEvent(event);

        if (line) {
          pushLog(line);
        }
      },
    });

  /** Step 1 of design mode: prompt -> mockups. */
  const createDesigns = async () => {
    if (busy) {
      return;
    }

    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setLog([]);
    setVariants([]);
    setDesigns([]);
    setChosenDesign(0);
    setStatus('Generating page mockups...');

    try {
      const text = validateDesignPrompt(prompt);
      const result = await designFor({ prompt: text, count: DESIGN_COUNT, signal: abort.signal });

      if (mounted.current && !abort.signal.aborted) {
        setDesigns(result);
        setStatus(
          `${result.length} mockup${result.length === 1 ? '' : 's'} generated. Pick the one to turn into code.`,
        );
      }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Design generation failed.');
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  /**
   * Step 2 of design mode: the chosen mockup becomes code.
   *
   * It reuses the exact image path, so a generated mockup and an uploaded screenshot
   * behave identically from here on — one pipeline, two entry points.
   */
  const codeFromDesign = async () => {
    const chosen = designs[chosenDesign];

    if (!chosen || busy) {
      return;
    }

    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setVariants([]);
    setSelected(0);
    setStatus('Turning the mockup into code...');
    setLog([]);

    try {
      const asFile = await dataUrlToFile(chosen.image, `design-${chosenDesign + 1}.png`);
      const image = validateScreenshot(await readImage(asFile));

      if (abort.signal.aborted) {
        return;
      }

      const result = await runGeneration(image, abort);

      if (mounted.current && !abort.signal.aborted) {
        setVariants(result);
        setStatus(
          result.length === 1
            ? 'Code ready. Review it before importing.'
            : `${result.length} versions generated. Pick the one to import.`,
        );
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

  /** Screenshot mode: the uploaded file straight into the pipeline. */
  const start = async () => {
    if (!file || busy) {
      return;
    }

    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setVariants([]);
    setSelected(0);
    setStatus('Reading the image...');
    setLog([]);

    try {
      const image = validateScreenshot(await readImage(file));

      if (abort.signal.aborted) {
        return;
      }

      const result = await runGeneration(image, abort);

      if (mounted.current && !abort.signal.aborted) {
        setVariants(result);
        setStatus(
          result.length === 1
            ? 'Code ready. Review it before importing.'
            : `${result.length} versions generated. Pick the one to import.`,
        );
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
    const chosen = variants[selected];

    if (!chosen || busy) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      validateImportableHtml(chosen.code);

      const path = await importCode(chosen.code);

      if (mounted.current) {
        setStatus(`Imported ${path}. Ask Bolt to refine it in the chat.`);
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

  const current = variants[selected];
  const chosenMockup = designs[chosenDesign];

  return (
    <div className="flex flex-col gap-4 text-sm text-bolt-elements-textPrimary">
      {/* Mode switch: two visible cards, so the choice is seen rather than hunted. */}
      <div role="radiogroup" aria-label="Starting point" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MODES.map((option) => {
          const active = mode === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.title}
              data-testid={`mode-${option.value}`}
              disabled={busy}
              onClick={() => switchMode(option.value)}
              className={classNames(
                // A bare <button> keeps the UA's light grey fill, so the fill must be explicit.
                'relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all',
                'disabled:cursor-not-allowed disabled:opacity-60',
                // The dialog already paints depth-2, so depth-2 on the card was invisible:
                // an unchecked card looked identical to the dialog surface (i.e. "greyed out").
                active
                  ? 'border-bolt-elements-borderColorActive bg-bolt-elements-background-depth-3 shadow-sm'
                  : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-background-depth-3',
              )}
            >
              <span
                className={classNames(
                  option.icon,
                  'mt-0.5 text-xl',
                  active ? 'text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textSecondary',
                )}
                aria-hidden
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{option.title}</span>
                <span className="text-xs text-bolt-elements-textSecondary">{option.hint}</span>
              </span>
              {active && (
                <span
                  className="i-ph:check-circle-fill absolute right-2 top-2 text-base text-bolt-elements-item-contentAccent"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ---- Design mode: prompt -> mockups -> code ---- */}
      {mode === 'design' && (
        <div className="flex flex-col gap-3">
          <Label htmlFor="design-prompt">What page do you want?</Label>
          <textarea
            id="design-prompt"
            aria-label="Design description"
            value={prompt}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="A landing page for a bakery: hero, three product cards, opening hours, footer"
            rows={3}
            className={classNames(
              'w-full resize-y rounded-lg border border-bolt-elements-borderColor px-3 py-2',
              'bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary',
              'placeholder:text-bolt-elements-textSecondary focus:border-bolt-elements-borderColorActive focus:outline-none',
            )}
          />

          <Button
            type="button"
            disabled={busy || prompt.trim().length < 3}
            onClick={() => void createDesigns()}
            className="self-start bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
          >
            Generate {DESIGN_COUNT} mockups
          </Button>

          {designs.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-bolt-elements-textSecondary">
                Pick the mockup to build. Each one is a different direction.
              </p>
              <div role="radiogroup" aria-label="Generated mockups" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {designs.map((design, index) => {
                  const active = index === chosenDesign;

                  return (
                    <button
                      key={`${design.direction}-${index}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`${design.direction} mockup`}
                      disabled={busy}
                      onClick={() => setChosenDesign(index)}
                      className={classNames(
                        'relative flex flex-col overflow-hidden rounded-xl border text-left transition-all',
                        active
                          ? 'border-bolt-elements-borderColorActive ring-2 ring-bolt-elements-borderColorActive'
                          : 'border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive',
                      )}
                    >
                      <img
                        src={design.image}
                        alt={`${design.direction} mockup preview`}
                        className="h-40 w-full bg-white object-cover"
                      />
                      <span className="flex items-center gap-2 px-3 py-2">
                        <span className="text-xs font-medium">{design.direction}</span>
                        {active && (
                          <span
                            className="i-ph:check-circle-fill ml-auto text-sm text-bolt-elements-item-contentAccent"
                            aria-hidden
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <Button
                type="button"
                disabled={busy || !chosenMockup}
                onClick={() => void codeFromDesign()}
                className="self-start bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
              >
                Turn this mockup into code
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- Screenshot mode: upload -> code ---- */}
      {mode === 'screenshot' && (
        <div className="flex flex-col gap-3">
          <Label htmlFor="screenshot-image">Screenshot image</Label>
          <Input
            id="screenshot-image"
            aria-label="Screenshot image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => select(event.target.files?.[0])}
            disabled={busy}
            className="h-auto rounded-full py-2 file:mr-3 file:rounded-full file:border-0 file:bg-bolt-elements-background-depth-3 file:px-3 file:py-1 file:text-bolt-elements-textPrimary"
          />
          {file && <span className="text-xs text-bolt-elements-textSecondary">{file.name}</span>}

          <Button
            type="button"
            disabled={!file || busy}
            onClick={() => void start()}
            className="self-start bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
          >
            Turn this image into code
          </Button>
        </div>
      )}

      {/* ---- Shared output side ---- */}
      <Label htmlFor="screenshot-stack">Output stack</Label>
      <select
        id="screenshot-stack"
        aria-label="Output stack"
        value={stack}
        disabled={busy}
        onChange={(event) => setStack(event.target.value as Stack)}
        className={classNames(
          'rounded-md border border-bolt-elements-borderColor px-3 py-2',
          'bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary',
        )}
      >
        {STACKS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {busy && (
        <Button type="button" variant="outline" onClick={() => controller.current?.abort()} className="self-start">
          Cancel
        </Button>
      )}

      {status && (
        <p role="status" className="text-bolt-elements-textSecondary">
          {status}
        </p>
      )}

      {log.length > 0 && (
        <details className="rounded-md border border-bolt-elements-borderColor px-3 py-2">
          <summary className="cursor-pointer text-xs text-bolt-elements-textSecondary">
            Generation progress ({log.length})
          </summary>
          <ul aria-label="Generation progress" className="mt-2 flex flex-col gap-0.5">
            {log.map((line, index) => (
              <li key={`${index}-${line}`} className="truncate text-xs text-bolt-elements-textSecondary">
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}

      {variants.length > 0 && (
        <>
          <p className="text-xs text-bolt-elements-textSecondary">
            The preview is a static, scriptless rendering in an isolated frame. The source is saved in Bolt only after
            you import it.
          </p>

          {variants.length > 1 && (
            <div role="group" aria-label="Generated versions" className="flex flex-wrap gap-2">
              {variants.map((variant, index) => (
                <button
                  key={variant.index}
                  type="button"
                  aria-pressed={index === selected}
                  onClick={() => setSelected(index)}
                  className={classNames(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    index === selected
                      ? 'border-bolt-elements-borderColorActive bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary'
                      : 'border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
                  )}
                >
                  Version {index + 1}
                </button>
              ))}
            </div>
          )}

          {current && (
            <>
              <iframe
                title={`Generated version ${selected + 1} preview`}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">${current.code}`}
                className="h-64 w-full rounded-md border border-bolt-elements-borderColor bg-white"
              />
              <textarea
                aria-label="Generated HTML source"
                readOnly
                value={current.code}
                className={classNames(
                  'w-full min-h-32 rounded-md border border-bolt-elements-borderColor',
                  'bg-bolt-elements-background-depth-1 px-3 py-2 font-mono text-xs text-bolt-elements-textPrimary',
                )}
              />
              <Button
                type="button"
                onClick={() => void importFile()}
                disabled={busy}
                className="self-start bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
              >
                Import into Bolt
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
