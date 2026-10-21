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
import { importScreenshotHtml, requiresScriptConsent, validateImportableHtml } from '~/lib/screenshot/import';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

type Props = {
  generate?: typeof generateScreenshotCode;
  onContinue?: (code: string, path: string) => void;
  importCode?: (code: string, options?: { allowScripts?: boolean }) => Promise<string>;

  /** Text-to-image step: a prompt becomes page mockups to choose from. */
  designFor?: typeof generateDesigns;
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
const MODE_CARD_SURFACE = 'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary';
const MODE_CARD_ACTIVE_SURFACE = 'bg-bolt-elements-item-backgroundAccent';

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
/** Translate service messages owned by this workflow; retain unknown diagnostics verbatim. */
function localizeMessage(text: string): string {
  const messages: Record<string, string> = {
    'Screenshot service connection failed.': 'Connexion au service de génération impossible. Réessayez.',
    'Screenshot service connection closed unexpectedly.': 'La connexion au service de génération a été interrompue.',
    'Screenshot service failed.': 'Le service de génération a échoué.',
    'Screenshot generation cancelled.': 'Génération annulée.',
    'Invalid screenshot service response. Nothing was imported.': 'Réponse du service invalide. Aucun fichier importé.',
    'Screenshot generation incomplete or unsafe. Nothing was imported.':
      'Génération incomplète ou non valide. Aucun fichier importé.',
    'Generated code is not a complete HTML page. Nothing was imported.':
      'Le code n’est pas une page HTML complète. Aucun fichier importé.',
    'Choose a PNG, JPEG, or WebP screenshot under 10 MB.':
      'Choisissez une capture PNG, JPEG ou WebP de moins de 10 Mo.',
    'Describe the page you want (at least a few words).': 'Décrivez la page souhaitée en quelques mots.',
    'Keep the description under 1500 characters.': 'Limitez la description à 1 500 caractères.',
    'Design generation returned no image.': 'La génération n’a renvoyé aucune maquette.',
    'Design generation returned no usable image.': 'La génération n’a renvoyé aucune maquette exploitable.',
    'Could not create the generated HTML file. Impossible d’enregistrer le fichier dans le projet.':
      'Impossible d’enregistrer le fichier HTML dans le projet.',
  };

  return (
    messages[text] ??
    text
      .replace(/^Design generation failed: /, 'La génération des maquettes a échoué : ')
      .replace(/^Generating code(?:\.\.\.|…)?$/i, 'Génération du code…')
      .replace(/^Generating (?:your )?(?:design|page)(?:\.\.\.|…)?$/i, 'Génération de la page…')
      .replace(/^Connecting(?:\.\.\.|…)?$/i, 'Connexion…')
      .replace(/^Analyzing (?:the )?image(?:\.\.\.|…)?$/i, 'Analyse de l’image…')
  );
}

function describeEvent(event: StreamEvent): string | undefined {
  switch (event.kind) {
    case 'status':
      return localizeMessage(event.text);

    case 'variantCount':
      return `Génération de ${event.count} version${event.count === 1 ? '' : 's'}…`;

    case 'toolStart':
      return `Exécution de ${event.name}…`;

    default:
      return undefined;
  }
}

export function ScreenshotToCode({
  generate = generateScreenshotCode,
  onContinue,
  importCode = (code, options) => importScreenshotHtml(code, workbenchStore, options),
  designFor = generateDesigns,
}: Props) {
  const [mode, setMode] = useState<Mode>('design');
  const [prompt, setPrompt] = useState('');
  const [designs, setDesigns] = useState<Design[]>([]);
  const [chosenDesign, setChosenDesign] = useState(0);

  const [file, setFile] = useState<File>();
  const [stack, setStack] = useState<Stack>('html_tailwind');
  const [status, setStatus] = useState('');
  const [log, setLog] = useState<Array<{ key?: string; text: string }>>([]);
  const [consents, setConsents] = useState<Record<number, boolean>>({});
  const [filePreview, setFilePreview] = useState('');
  const [imported, setImported] = useState<{ code: string; path: string } | null>(null);
  const [error, setError] = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const sourceProject = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setFilePreview('');

    if (file) {
      void readImage(file)
        .then((image) => {
          if (active) {
            setFilePreview(image);
          }
        })
        .catch(() => {
          /* The generation reader reports errors when needed. */
        });
    }

    return () => {
      active = false;
    };
  }, [file]);

  const pushLog = (line: string) => {
    setLog((current) => [...current, { text: line }].slice(-MAX_LOG_LINES));
  };

  const reset = () => {
    controller.current?.abort();
    controller.current = null;
    setStatus('');
    setLog([]);
    setError('');
    setVariants([]);
    setImported(null);
    setConsents({});
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

        if (event.kind === 'assistant' || event.kind === 'thinking') {
          // Keep whitespace: stream frames are fragments, not individual messages.
          const variantIndex = (event as StreamEvent & { variantIndex?: number }).variantIndex;
          const key = `${event.kind}-${variantIndex ?? 'shared'}`;
          const label = `${variantIndex === undefined ? '' : `Version ${variantIndex + 1} · `}${event.kind === 'thinking' ? 'Réflexion' : 'Assistant'} : `;
          setLog((current) => {
            const existing = current.find((entry) => entry.key === key);

            return existing
              ? current.map((entry) =>
                  entry.key === key ? { key, text: (entry.text + event.text).slice(0, 8000) } : entry,
                )
              : [...current, { key, text: label + event.text }].slice(-MAX_LOG_LINES);
          });

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
    sourceProject.current = workbenchStore.projectGeneration.get();
    setBusy(true);
    setError('');
    setLog([]);
    setVariants([]);
    setImported(null);
    setConsents({});
    setDesigns([]);
    setChosenDesign(0);
    setStatus('Génération des maquettes...');

    try {
      const text = validateDesignPrompt(prompt);
      const progressive = new Map<number, Design>();

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

          progressive.set(index, design);
          setDesigns([...progressive.entries()].sort(([a], [b]) => a - b).map(([, mockup]) => mockup));
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
        setError(cause instanceof Error ? localizeMessage(cause.message) : 'La génération du design a échoué.');
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;

        if (mounted.current) {
          setBusy(false);
        }
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
    sourceProject.current = workbenchStore.projectGeneration.get();
    setBusy(true);
    setError('');
    setVariants([]);
    setImported(null);
    setConsents({});
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
            ? 'Code prêt. Vérifiez-le avant de l’importer.'
            : `${result.length} versions générées. Choisissez celle à importer.`,
        );
      }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) {
        setError(cause instanceof Error ? localizeMessage(cause.message) : 'La génération a échoué.');
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;

        if (mounted.current) {
          setBusy(false);
        }
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
    sourceProject.current = workbenchStore.projectGeneration.get();
    setBusy(true);
    setError('');
    setVariants([]);
    setImported(null);
    setConsents({});
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
            ? 'Code prêt. Vérifiez-le avant de l’importer.'
            : `${result.length} versions générées. Choisissez celle à importer.`,
        );
      }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) {
        setError(cause instanceof Error ? localizeMessage(cause.message) : 'La génération a échoué.');
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;

        if (mounted.current) {
          setBusy(false);
        }
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
    setImported(null);

    try {
      if (sourceProject.current !== workbenchStore.projectGeneration.get()) {
        throw new Error(
          'Le projet a changé depuis la génération. Relancez la génération dans le projet actuel avant d’importer.',
        );
      }

      const active = requiresScriptConsent(chosen.code);

      if (active && !consents[selected]) {
        throw new Error('Autorisez explicitement l’import du code interactif pour cette version.');
      }

      const options = active ? { allowScripts: true } : undefined;
      validateImportableHtml(chosen.code, options);

      const path = options ? await importCode(chosen.code, options) : await importCode(chosen.code);

      if (mounted.current) {
        setImported({ code: chosen.code, path });
        setStatus(`Fichier importé : ${path}. Demandez à Bolt de l’améliorer dans le chat.`);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? localizeMessage(cause.message) : 'L’import a échoué.');
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setStatus('Génération annulée.');
  };

  const chooseDesign = (index: number) => {
    if (index !== chosenDesign) {
      reset();
      setChosenDesign(index);
    }
  };

  const navigateCards = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    count: number,
    choose: (index: number) => void,
  ) => {
    const offset = ['ArrowRight', 'ArrowDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key)
        ? -1
        : 0;

    if (!offset || busy) {
      return;
    }

    event.preventDefault();

    const next = (index + offset + count) % count;
    const cards = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]');
    choose(next);
    cards?.[next]?.focus();
  };

  const current = variants[selected];
  const activeSource = current ? requiresScriptConsent(current.code) : false;
  const chosenMockup = designs[chosenDesign];

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
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) =>
                navigateCards(
                  event,
                  MODES.findIndex((item) => item.value === mode),
                  MODES.length,
                  (index) => switchMode(MODES[index].value),
                )
              }
              className={classNames(
                'relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all',

                /*
                 * A <button> without an explicit fill paints the UA grey (rgb(239,239,239)) in the
                 * dark theme, which read as a white, disabled card. Own the surface on both states:
                 * the unchecked card is ONE depth step above the dialog (depth-2), the checked one
                 * two steps, so the difference is visible without relying on the border alone.
                 */
                MODE_CARD_SURFACE,
                'disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
                active
                  ? `border-bolt-elements-borderColorActive ${MODE_CARD_ACTIVE_SURFACE} shadow-sm`
                  : 'border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-item-backgroundAccent',
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
            className="self-start gap-2 !rounded-full px-5 bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text"
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
                Choisissez la maquette à construire. Chacune est une direction différente.
              </p>
              <div role="radiogroup" aria-label="Maquettes générées" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {designs.map((design, index) => {
                  const active = index === chosenDesign;

                  return (
                    <button
                      key={`${design.direction}-${index}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`Maquette ${design.direction}`}
                      disabled={busy}
                      onClick={() => chooseDesign(index)}
                      tabIndex={active ? 0 : -1}
                      onKeyDown={(event) => navigateCards(event, index, designs.length, chooseDesign)}
                      className={classNames(
                        'relative flex flex-col overflow-hidden rounded-xl border bg-bolt-elements-background-depth-1 text-left transition-colors',

                        // Same UA-grey trap as the mode cards: own the surface explicitly.
                        'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
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
                  );
                })}
              </div>

              <Button
                type="button"
                disabled={busy || !chosenMockup}
                onClick={() => void codeFromDesign()}
                className="self-start !rounded-full px-5 bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text"
              >
                Transformer cette maquette en code
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
          {filePreview && (
            <img src={filePreview} alt="Image sélectionnée" className="max-h-48 w-full rounded-lg object-contain" />
          )}

          <Button
            type="button"
            disabled={!file || busy}
            onClick={() => void start()}
            className="self-start !rounded-full px-5 bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text"
          >
            Transformer cette image en code
          </Button>
        </div>
      )}

      {/* ---- Shared output side ---- */}
      <Label htmlFor="screenshot-stack">Stack de sortie</Label>
      <select
        id="screenshot-stack"
        aria-label="Stack de sortie"
        value={stack}
        disabled={busy}
        onChange={(event) => {
          reset();
          setStack(event.target.value as Stack);
        }}
        className={classNames(
          'w-full appearance-none rounded-lg border border-bolt-elements-borderColor px-3 py-2 pr-9',
          'bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary',
          'focus-visible:border-bolt-elements-borderColorActive focus-visible:outline-none',
        )}
      >
        {STACKS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {busy && controller.current && (
        <Button type="button" variant="outline" onClick={cancel} className="self-start">
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
              <li
                key={line.key ?? index}
                className="whitespace-pre-wrap break-words text-xs text-bolt-elements-textSecondary"
              >
                {line.text}
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
            qu’après l’import. L’import sauvegarde un fichier HTML sans exécuter les scripts et ne crée pas une
            application React multi-fichiers.
          </p>

          {variants.length > 1 && (
            <div role="group" aria-label="Versions générées" className="flex flex-wrap gap-2">
              {variants.map((variant, index) => (
                <button
                  key={variant.index}
                  type="button"
                  aria-pressed={index === selected}
                  disabled={busy}
                  onClick={() => {
                    if (index !== selected) {
                      setImported(null);
                      setSelected(index);
                      setError('');
                      setStatus('');
                    }
                  }}
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
              {activeSource && (
                <div className="rounded-lg border border-bolt-elements-borderColorActive bg-bolt-elements-background-depth-3 p-3">
                  <p className="text-sm">
                    Cette version contient du code interactif (scripts, React ou Babel). React n’est pas rendu dans cet
                    aperçu statique : une page vide ne signifie pas que le code est perdu. Les scripts restent bloqués
                    ici.
                  </p>
                  <p className="mt-2 text-xs text-bolt-elements-textSecondary">
                    Après l’import, ces scripts et leurs dépendances externes pourront s’exécuter dans le projet.
                    Vérifiez la source et n’autorisez que du code de confiance.
                  </p>
                  <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!consents[selected]}
                      disabled={busy}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setConsents((previous) => ({ ...previous, [selected]: checked }));
                      }}
                      className="focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive"
                    />
                    J’autorise l’import du code interactif
                  </label>
                </div>
              )}
              <details className="rounded-md border border-bolt-elements-borderColor px-3 py-2">
                <summary className="cursor-pointer">Voir la source HTML</summary>
                <textarea
                  aria-label="Source HTML générée"
                  readOnly
                  value={current.code}
                  className={classNames(
                    'mt-2 w-full min-h-32 rounded-md border border-bolt-elements-borderColor',
                    'bg-bolt-elements-background-depth-1 px-3 py-2 font-mono text-xs text-bolt-elements-textPrimary',
                  )}
                />
              </details>
              <a
                href={`data:text/html;charset=utf-8,${encodeURIComponent(current.code)}`}
                download={`version-${selected + 1}.html`}
                className="inline-flex min-h-11 items-center self-start rounded-md px-3 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive"
              >
                Télécharger le HTML
              </a>
              <Button
                type="button"
                onClick={() => void importFile()}
                disabled={busy || (activeSource && !consents[selected])}
                className="self-start !rounded-full px-5 bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text"
              >
                Importer dans Bolt
              </Button>
              {imported && onContinue && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (sourceProject.current !== workbenchStore.projectGeneration.get()) {
                      setImported(null);
                      setError('Le projet a changé. Importez le code dans le projet actuel avant de continuer.');

                      return;
                    }

                    onContinue(imported.code, imported.path);
                  }}
                  className="self-start"
                >
                  Continuer avec Bolt
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
