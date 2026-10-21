import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '~/components/ui/Button';
import { Dialog, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { IconButton } from '~/components/ui/IconButton';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';
import { generateDesigns, validateDesignPrompt, DESIGN_COUNT, type Design } from '~/lib/screenshot/designs';
import {
  generateScreenshotCode,
  validateScreenshot,
  type Stack,
  type StreamEvent,
  type Variant,
} from '~/lib/screenshot/generate';
import { importScreenshotHtml, validateImportableHtml } from '~/lib/screenshot/import';
import { buildProjectInstruction, pickTemplate, templateLabel } from '~/lib/screenshot/project';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

type Props = {
  generate?: typeof generateScreenshotCode;
  importCode?: (code: string) => Promise<string>;

  /** Text-to-image step: a prompt becomes page mockups to choose from. */
  designFor?: typeof generateDesigns;

  /**
   * Start a NEW project from the chosen design (or the uploaded screenshot): the image becomes the
   * reference of a React + TypeScript + Tailwind + shadcn/ui project built by the agent, instead of
   * a throwaway HTML file. When absent, the panel falls back to the flat-file import.
   */
  onStartProject?: (args: { prompt: string; image: string; template: string }) => void;
};

/** Cap on the streamed progress lines kept in the panel, so a long run cannot grow forever. */
const MAX_LOG_LINES = 60;

/** The two ways into a project. Chosen with a visible card, not a hidden dropdown. */
type Mode = 'design' | 'screenshot';

/**
 * Surface of the mode cards, shared by the stylesheet class and the spec.
 *
 * A bare <button> paints the UA grey in the dark theme, which read as a white, disabled card, so
 * every card names its own fill. The unchecked card sits one depth step above the dialog
 * (depth-2 -> depth-3); the checked one takes the accent tint, because depth-4 is a 7% white that
 * measures within a few points of depth-3 and left the active card looking as flat as the other.
 */
const MODE_CARD_SURFACE = 'bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary';

/* Active: one step above the idle card (depth-3) plus the accent border, never equal to either. */
const MODE_CARD_ACTIVE_SURFACE = 'bg-bolt-elements-background-depth-3';

const MODES: Array<{ value: Mode; icon: string; title: string; hint: string }> = [
  {
    value: 'design',
    icon: 'i-ph:sparkle-duotone',
    title: 'Générer un design',
    hint: 'Décrivez la page, choisissez une maquette',
  },
  {
    value: 'screenshot',
    icon: 'i-ph:image-duotone',
    title: 'Utiliser une image',
    hint: 'Transformez une capture ou une maquette en code',
  },
];

const readImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Impossible de lire la capture.'));
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

const grid = classNames(
  'grid grid-cols-1 gap-3',

  /* Below sm the three mockups would be unreadably small: one column, so each preview is legible. */
  'sm:grid-cols-3',
);

const TILE =
  'flex flex-col overflow-hidden rounded-xl border bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary transition-colors';

/** The mockup viewer is wide: it needs the full screen, not the dialog's 520px. */
/*
 * Width has to be an arbitrary value, not `max-w-*`: the shared Dialog also carries
 * `w-[min(520px,...)]` and Tailwind orders utilities by class name, so a competing `w-[...]`
 * loses to it (measured 520px in production). `min()` with 100vw keeps it on screen on mobile.
 */
const VIEWER_DIALOG = 'w-full max-w-none max-h-[92vh] min-h-[60vh] overflow-hidden rounded-2xl';

/**
 * Widens the viewer past the shared Dialog's own `w-[min(520px,...)]`.
 *
 * The dialog's width utility wins the cascade against ours (measured: 520px in production),
 * so the rule is injected unlayered and scoped to `.viewer-dialog`. It goes in <head> so it
 * is never announced as content.
 */
function ViewerWidth() {
  /* Portalled to <head>: a <style> left in the dialog body would be read out as text. */
  return createPortal(
    <style>{`@media (min-width: 640px) { .viewer-dialog { width: min(1400px, calc(100vw - 1.5rem)); } }`}</style>,
    document.head,
  );
}

/**
 * One mockup, full screen, with zoom.
 *
 * Three thumbnails in a panel cannot be judged: the whole point of a mockup is small type and
 * layout detail. This viewer shows one direction at a time at a readable size, keeps the
 * thumbnail as the selector, and lets the user zoom (buttons, wheel, pinch, double-click) and
 * pan, with arrow keys to walk through the other directions.
 *
 * `html` mode is used deliberately: the shared `Dialog` clamps to 520px, which is where this
 * feature started.
 */
function MockupViewer({
  designs,
  index,
  onIndexChange,
  onClose,
}: {
  designs: Design[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const stage = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; origin: { x: number; y: number } } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const design = designs[index];
  const total = designs.length;

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* A different mockup starts from its own neutral view. */
  useEffect(() => {
    reset();
  }, [index, reset]);

  /**
   * How far the image may be dragged at this zoom level.
   *
   * Measured on the UNSCALED image box (offsetWidth/Height ignore the CSS transform) times the
   * zoom, against the stage. A dimension that still fits clamps to 0, so the mockup can never be
   * dragged out of its own frame; at 150 % a portrait mockup overflows sideways only, which is
   * exactly what the drag should allow.
   */
  const clamp = useCallback((x: number, y: number, level: number) => {
    const el = image.current;
    const width = el?.offsetWidth ?? 0;
    const height = el?.offsetHeight ?? 0;
    const stageWidth = stage.current?.clientWidth ?? 0;
    const stageHeight = stage.current?.clientHeight ?? 0;
    const maxX = Math.max(0, (width * level - stageWidth) / 2);
    const maxY = Math.max(0, (height * level - stageHeight) / 2);

    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);

  const applyZoom = useCallback(
    (next: number) => {
      const level = Math.max(1, Math.min(6, next));

      setZoom(level);
      setPan((current) => (level === 1 ? { x: 0, y: 0 } : clamp(current.x, current.y, level)));
    },
    [clamp],
  );

  const stepper = (factor: number) => applyZoom(zoom * factor);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const pans: Record<string, [number, number]> = {
      ArrowLeft: [60, 0],
      ArrowRight: [-60, 0],
      ArrowUp: [0, 60],
      ArrowDown: [0, -60],
    };

    if (event.key === '+' || event.key === '=') {
      stepper(1.5);
    } else if (event.key === '-' || event.key === '_') {
      stepper(1 / 1.5);
    } else if (event.key === '0') {
      reset();
    } else if (event.key === 'ArrowLeft' && event.altKey) {
      onIndexChange((index - 1 + total) % total);
    } else if (event.key === 'ArrowRight' && event.altKey) {
      onIndexChange((index + 1) % total);
    } else if (pans[event.key] && zoom > 1) {
      const [dx, dy] = pans[event.key];
      setPan((current) => clamp(current.x + dx, current.y + dy, zoom));
    } else {
      return;
    }

    event.preventDefault();
  };

  const startDrag = (event: React.PointerEvent) => {
    if (zoom === 1) {
      return;
    }

    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: pan };
    setDragging(true);
  };

  const moveDrag = (event: React.PointerEvent) => {
    const current = drag.current;

    if (!current || current.id !== event.pointerId) {
      return;
    }

    setPan(clamp(current.origin.x + (event.clientX - current.x), current.origin.y + (event.clientY - current.y), zoom));
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    stepper(event.deltaY < 0 ? 1.2 : 1 / 1.2);
  };

  const pinchDistance = (event: React.TouchEvent) => {
    if (event.touches.length !== 2) {
      return undefined;
    }

    const [a, b] = [event.touches[0], event.touches[1]];

    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  if (!design) {
    return null;
  }

  return (
    <DialogRoot open onOpenChange={(next) => !next && onClose()}>
      <Dialog className={VIEWER_DIALOG} showCloseButton={false} onClose={onClose} onEscapeKeyDown={() => onClose()}>
        <ViewerWidth />

        {/* role=presentation: a plain layout box, so the dialog keeps its own semantics. */}
        <div role="presentation" className="viewer-dialog flex w-full flex-col" onKeyDown={onKeyDown}>
          <div className="flex flex-wrap items-center gap-2 border-b border-bolt-elements-borderColor px-3 py-2">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">{design.direction}</DialogTitle>
              <DialogDescription className="text-xs">
                Maquette {index + 1} sur {total}
              </DialogDescription>
            </div>

            <div className="flex items-center gap-1 rounded-full bg-bolt-elements-background-depth-3 px-1">
              <IconButton
                icon="i-ph:minus"
                title="Zoom arrière"
                onClick={() => stepper(1 / 1.5)}
                disabled={zoom <= 1}
              />
              <span className="w-12 text-center text-xs tabular-nums" aria-live="polite">
                {Math.round(zoom * 100)} %
              </span>
              <IconButton icon="i-ph:plus" title="Zoom avant" onClick={() => stepper(1.5)} disabled={zoom >= 6} />
              <IconButton icon="i-ph:arrows-out-simple" title="Ajuster à l’écran" onClick={reset} />
            </div>

            <div className="flex items-center gap-1">
              <IconButton
                icon="i-ph:caret-left"
                title="Maquette précédente"
                disabled={total < 2}
                onClick={() => onIndexChange((index - 1 + total) % total)}
              />
              <IconButton
                icon="i-ph:caret-right"
                title="Maquette suivante"
                disabled={total < 2}
                onClick={() => onIndexChange((index + 1) % total)}
              />
            </div>

            <Button
              type="button"
              onClick={() => {
                onIndexChange(index);
                onClose();
              }}
              className="gap-2 !rounded-full px-4 !bg-accent-700 !text-white hover:!bg-accent-800"
            >
              Choisir cette maquette
            </Button>

            <IconButton icon="i-ph:x" title="Fermer" onClick={onClose} />
          </div>

          <div
            ref={stage}
            className={classNames(
              'relative overflow-hidden bg-bolt-elements-background-depth-1',
              zoom > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
            )}
            style={{ height: 'min(78vh, 900px)' }}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={onWheel}
            onDoubleClick={() => (zoom > 1 ? reset() : applyZoom(2))}
            onTouchStart={(event) => {
              const distance = pinchDistance(event);

              if (distance !== undefined) {
                pinch.current = { distance, zoom };
              }
            }}
            onTouchMove={(event) => {
              const distance = pinchDistance(event);

              if (distance === undefined || !pinch.current) {
                return;
              }

              event.preventDefault();
              applyZoom(pinch.current.zoom * (distance / pinch.current.distance));
            }}
            onTouchEnd={() => {
              pinch.current = null;
            }}
          >
            <div className="flex h-full w-full items-center justify-center p-2">
              <img
                ref={image}
                src={design.image}
                alt={`Maquette ${design.direction} en grand`}
                draggable={false}
                onLoad={() => setPan((current) => clamp(current.x, current.y, zoom))}
                className="max-h-full max-w-full origin-center select-none object-contain shadow-lg transition-transform duration-100 ease-out"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
              />
            </div>
          </div>

          <p className="border-t border-bolt-elements-borderColor px-3 py-2 text-center text-[11px] text-bolt-elements-textSecondary">
            Molette ou pincez pour zoomer, double-clic pour 200 %, glissez pour déplacer, flèches pour naviguer, Échap
            pour fermer.
          </p>
        </div>
      </Dialog>
    </DialogRoot>
  );
}

export function ScreenshotToCode({
  generate = generateScreenshotCode,
  importCode = (code) => importScreenshotHtml(code, workbenchStore),
  designFor = generateDesigns,
  onStartProject,
}: Props) {
  const [mode, setMode] = useState<Mode>('design');
  const [prompt, setPrompt] = useState('');
  const [designs, setDesigns] = useState<Design[]>([]);
  const [chosenDesign, setChosenDesign] = useState(0);

  const [file, setFile] = useState<File>();

  /*
   * The stack selector is hidden (the user settled on React + TypeScript + Tailwind + shadcn/ui, and
   * Lovable/Bolt do not expose a per-generation framework choice either). The value stays because
   * the flat-file fallback path still needs one.
   */
  const [stack] = useState<Stack>('html_tailwind');
  const [status, setStatus] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  /** Index of the mockup shown full screen, or null when the viewer is closed. */
  const [viewer, setViewer] = useState<number | null>(null);
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
      setError('Choisissez une capture PNG, JPEG ou WebP de moins de 10 Mo.');

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
    setStatus('Génération des maquettes...');

    try {
      const text = validateDesignPrompt(prompt);

      /*
       * Progressive: each mockup appears the moment it is drawn. One subscription image takes
       * 30-56 s on this backend, so waiting for all three left the panel frozen for minutes.
       */
      const result = await designFor({
        prompt: text,
        count: DESIGN_COUNT,
        signal: abort.signal,
        onDesign: (design, index, done, total) => {
          if (!mounted.current || abort.signal.aborted) {
            return;
          }

          /*
           * Place each mockup in its art-direction slot. A `.filter(Boolean)` on a sparse array
           * COMPACTS the holes, so when the second image landed first the array became [design2]:
           * `designs[chosenDesign]` (index 0) then held the wrong mockup and every index-based read
           * was off by one. Keep the holes and let the render skip them.
           */
          setDesigns((previous) => {
            const next: Array<Design | undefined> = [...previous];
            next[index] = design;

            return next as Design[];
          });
          setStatus(`Maquette ${done} sur ${total} prête...`);
          pushLog(`Maquette ${index + 1} (${design.direction}) prête.`);
        },
      });

      if (mounted.current && !abort.signal.aborted && result.length > 0) {
        setDesigns(result);
        setStatus(
          result.length === 1
            ? 'Maquette prête. Choisissez-la pour la transformer en code.'
            : `${result.length} maquettes prêtes. Choisissez celle à transformer en code.`,
        );
      }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'La génération du design a échoué.');
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
    setStatus('Transformation de la maquette en code...');
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
        setError(cause instanceof Error ? cause.message : 'La génération a échoué.');
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
    setStatus('Lecture de l’image...');
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
        setError(cause instanceof Error ? cause.message : 'La génération a échoué.');
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
        setError(cause instanceof Error ? cause.message : 'L’import a échoué.');
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  /**
   * Turn a design (or an upload) into a NEW project.
   *
   * This is the primary path now: the image becomes the reference of a real project scaffolded from
   * a template (React + TypeScript + Tailwind + shadcn/ui by default) and built by the agent, the
   * same way Bolt and Lovable work. Without a handler the panel keeps the flat-file import, so the
   * component stays usable on its own.
   */
  const startProject = (args: { image: string; prompt: string; designs?: number; index?: number }) => {
    if (!onStartProject) {
      /* Fallback: the old flat HTML path, still gated by the import validator. */
      void codeFromDesign();

      return;
    }

    const template = pickTemplate(args.prompt);

    onStartProject({
      prompt: buildProjectInstruction({
        prompt: args.prompt,
        template,
        designCount: args.designs ?? 1,
        chosenIndex: args.index ?? 0,
      }),
      image: args.image,
      template,
    });
  };

  const startProjectFromFile = async () => {
    if (!file) {
      return;
    }

    const dataUrl = await readImage(file);

    if (!onStartProject) {
      /* Fallback: the flat-file path, which needs the generation to run first. */
      await start();

      return;
    }

    startProject({ image: dataUrl, prompt });
  };

  const current = variants[selected];

  /*
   * A sparse `designs` array (a mockup still drawing) can leave the chosen index on a hole; the
   * button then looked permanently disabled while a usable mockup was on screen. Resolve the
   * chosen index to the first real design and keep the slot index for selection.
   */
  const chosenIndex = designs[chosenDesign] ? chosenDesign : designs.findIndex(Boolean);

  const chosenMockup = chosenIndex >= 0 ? designs[chosenIndex] : undefined;

  return (
    <div className="flex flex-col gap-4 text-sm text-bolt-elements-textPrimary">
      {/* Mode switch: two visible cards, so the choice is seen rather than hunted. */}
      <div role="radiogroup" aria-label="Point de départ" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MODES.map((option) => {
          const active = mode === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.title}
              disabled={busy}
              onClick={() => switchMode(option.value)}
              className={classNames(
                'relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all',

                /*
                 * A <button> without an explicit fill paints the UA grey (rgb(239,239,239)) in the
                 * dark theme, which read as a white, disabled card. Own the surface on both states:
                 * the unchecked card is ONE depth step above the dialog (depth-2), the checked one
                 * two steps, so the difference is visible without relying on the border alone.
                 */
                MODE_CARD_SURFACE,
                'disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? `border-bolt-elements-borderColorActive ${MODE_CARD_ACTIVE_SURFACE} shadow-sm`
                  : 'border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-background-depth-2',
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
          <Label htmlFor="design-prompt">Quelle page voulez-vous ?</Label>
          <textarea
            id="design-prompt"
            aria-label="Description du design"
            value={prompt}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Une landing page pour une boulangerie : héro, trois cartes produit, horaires, pied de page"
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
            className="self-start gap-2 !rounded-full px-5 !bg-accent-700 !text-white hover:!bg-accent-800 disabled:!bg-accent-700/50"
          >
            {busy ? (
              <>
                <span className="i-ph:circle-notch-bold animate-spin" aria-hidden />
                Génération en cours…
              </>
            ) : (
              `Générer ${DESIGN_COUNT} maquettes`
            )}
          </Button>

          {busy && designs.length === 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-hidden>
              {Array.from({ length: DESIGN_COUNT }, (_, index) => (
                <div
                  key={index}
                  className="aspect-[3/4] animate-pulse rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1"
                />
              ))}
            </div>
          )}

          {designs.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-bolt-elements-textSecondary">
                Choisissez la maquette à construire. Chacune est une direction différente. Touchez l’aperçu pour
                l’agrandir et zoomer.
              </p>
              <div role="radiogroup" aria-label="Maquettes générées" className={grid}>
                {designs.map((design, index) => {
                  /* A slot whose image is still being drawn: skipped, never dereferenced. */
                  if (!design) {
                    return null;
                  }

                  const active = index === chosenDesign;

                  return (
                    <div key={`${design.direction}-${index}`} className="flex flex-col gap-1">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`Maquette ${design.direction}`}
                        disabled={busy}
                        onClick={() => setChosenDesign(index)}
                        className={classNames(
                          TILE,

                          /* Same UA-grey trap as the mode cards: own the surface explicitly. */
                          'text-left',
                          active
                            ? 'border-bolt-elements-borderColorActive bg-bolt-elements-background-depth-4 ring-2 ring-bolt-elements-borderColorActive'
                            : 'border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive',
                        )}
                      >
                        <img
                          src={design.image}
                          alt={`Aperçu de la maquette ${design.direction}`}
                          className="aspect-[3/4] w-full bg-bolt-elements-background-depth-3 object-cover object-top"
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

                      <button
                        type="button"
                        onClick={() => setViewer(index)}
                        aria-label={`Voir la maquette ${design.direction} en grand`}
                        className={classNames(
                          'flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          'border-bolt-elements-borderColor bg-transparent text-bolt-elements-textSecondary',
                          'hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-item-backgroundAccent hover:text-bolt-elements-textPrimary',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
                        )}
                      >
                        <span className="i-ph:magnifying-glass-plus text-sm" aria-hidden />
                        Voir en grand
                      </button>
                    </div>
                  );
                })}
              </div>

              <Button
                type="button"

                /*
                 * Only the presence of a usable mockup gates this button. `busy` stays true while the
                 * remaining mockups are drawn, and gating on it left the primary action disabled for
                 * a full minute with a finished design on screen.
                 */
                disabled={!chosenMockup}
                onClick={() =>
                  chosenMockup &&
                  startProject({
                    image: chosenMockup.image,
                    prompt,
                    designs: designs.filter(Boolean).length,
                    index: chosenIndex,
                  })
                }
                className="self-start gap-2 !rounded-full px-5 !bg-accent-700 !text-white hover:!bg-accent-800 disabled:!bg-accent-700/50"
              >
                <span className="i-ph:rocket-launch-bold" aria-hidden />
                Créer le projet {templateLabel(pickTemplate(prompt))}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- Screenshot mode: upload -> code ---- */}
      {mode === 'screenshot' && (
        <div className="flex flex-col gap-3">
          <Label htmlFor="screenshot-image">Image de capture</Label>
          <Input
            id="screenshot-image"
            aria-label="Image de capture"
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
            onClick={() => void startProjectFromFile()}
            className="self-start gap-2 !rounded-full px-5 !bg-accent-700 !text-white hover:!bg-accent-800 disabled:!bg-accent-700/50"
          >
            <span className="i-ph:rocket-launch-bold" aria-hidden />
            Créer le projet {templateLabel(pickTemplate(prompt))}
          </Button>
        </div>
      )}

      {/* ---- Shared output side ---- */}
      {/*
       * No stack selector. The project stack is React + TypeScript + Tailwind + shadcn/ui (a
       * framework typed in the prompt still wins, see `pickTemplate`), which is exactly the choice
       * Lovable refuses to expose and Bolt makes once, at project creation.
       */}
      <p className="flex items-center gap-2 text-xs text-bolt-elements-textSecondary">
        <span className="i-ph:info" aria-hidden />
        Le projet sera créé en React + TypeScript + Tailwind + shadcn/ui.
      </p>

      {busy && (
        <Button type="button" variant="outline" onClick={() => controller.current?.abort()} className="self-start">
          Annuler
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
            Progression de la génération ({log.length})
          </summary>
          <ul aria-label="Progression de la génération" className="mt-2 flex flex-col gap-0.5">
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
            L’aperçu est un rendu statique, sans script, dans une frame isolée. Le code n’est enregistré dans Bolt
            qu’après l’import.
          </p>

          {variants.length > 1 && (
            <div role="group" aria-label="Versions générées" className="flex flex-wrap gap-2">
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
                      : 'border-bolt-elements-borderColor bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
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
                title={`Aperçu de la version ${selected + 1}`}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">${current.code}`}
                className="h-64 w-full rounded-lg border border-bolt-elements-borderColor bg-white"
              />
              <textarea
                aria-label="Source HTML générée"
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
                className="self-start gap-2 !rounded-full px-5 !bg-accent-700 !text-white hover:!bg-accent-800 disabled:!bg-accent-700/50"
              >
                Importer dans Bolt
              </Button>
            </>
          )}
        </>
      )}

      {viewer !== null && designs[viewer] && (
        <MockupViewer
          designs={designs}
          index={viewer}
          onIndexChange={(next) => {
            setViewer(next);
            setChosenDesign(next);
          }}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
