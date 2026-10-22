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
    title: 'Créer une maquette',
    hint: 'Décrivez la page, puis choisissez une maquette',
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
      return `Génération de ${event.count} version${event.count > 1 ? 's' : ''}…`;

    case 'toolStart':
      return `Exécution de ${event.name}…`;

    case 'thinking': {
      const text = event.text.trim();

      return text ? `Réflexion : ${text.slice(0, 120)}` : undefined;
    }

    case 'assistant': {
      const text = event.text.trim();

      return text ? text.slice(0, 120) : undefined;
    }

    default:
      return undefined;
  }
}

/** Only known client messages are localized; provider details stay intact. */
function clientError(message: string): string {
  const messages: Record<string, string> = {
    'Describe the page you want (at least a few words).': 'Décrivez la page souhaitée en quelques mots.',
    'Keep the description under 1500 characters.': 'Limitez la description à 1 500 caractères.',
    'Choose a PNG, JPEG, or WebP screenshot under 10 MB.':
      'Choisissez une capture PNG, JPEG ou WebP de moins de 10 Mo.',
    'Generated code is not a complete HTML page. Nothing was imported.':
      'Le code généré n’est pas une page HTML complète. Aucun fichier n’a été importé.',
    'Generated HTML contains active content. Review the source and remove scripts before importing into Bolt.':
      'Import bloqué : le HTML contient du contenu actif. Téléchargez le code pour le vérifier et le corriger dans un éditeur externe. Aucun fichier n’a été écrit dans le projet.',
    'screenshot-generated.html already exists. Rename it before importing another screenshot.':
      'Le fichier screenshot-generated.html existe déjà. Renommez-le avant un nouvel import.',
    'Could not create the generated HTML file.': 'Impossible de créer le fichier HTML généré.',
    'Screenshot service connection failed.': 'La connexion au service de génération a échoué.',
    'Screenshot service connection closed unexpectedly.': 'La connexion au service de génération a été interrompue.',
    'Invalid screenshot service response. Nothing was imported.':
      'La réponse du service de génération est invalide. Aucun fichier n’a été importé.',
    'Screenshot generation incomplete or unsafe. Nothing was imported.':
      'La génération est incomplète ou non sécurisée. Aucun fichier n’a été importé.',
    'Design generation returned no image.': 'La génération n’a renvoyé aucune image.',
    'Design generation returned no usable image.': 'La génération n’a renvoyé aucune image utilisable.',
  };

  return Object.hasOwn(messages, message) ? messages[message] : message;
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
    controller.current = null;
    setBusy(false);
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
        if (!mounted.current || controller.current !== abort || abort.signal.aborted) {
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

    let text: string;

    try {
      text = validateDesignPrompt(prompt);
    } catch (cause) {
      setStatus('');
      setLog([]);
      setError(cause instanceof Error ? clientError(cause.message) : 'Description invalide.');

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
    setStatus('Génération des maquettes…');

    try {
      const result = await designFor({ prompt: text, count: DESIGN_COUNT, signal: abort.signal });

      if (mounted.current && controller.current === abort && !abort.signal.aborted) {
        setDesigns(result);
        setStatus(
          `${result.length} maquette${result.length > 1 ? 's' : ''} générée${result.length > 1 ? 's' : ''}. Choisissez celle à transformer en code.`,
        );
      }
    } catch (cause) {
      if (mounted.current && controller.current === abort && !abort.signal.aborted) {
        setStatus('');
        setLog([]);
        setError(cause instanceof Error ? clientError(cause.message) : 'La génération des maquettes a échoué.');
      }
    } finally {
      if (mounted.current && controller.current === abort) {
        controller.current = null;
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
    setStatus('Transformation de la maquette en code…');
    setLog([]);

    try {
      const asFile = await dataUrlToFile(chosen.image, `design-${chosenDesign + 1}.png`);
      const image = validateScreenshot(await readImage(asFile));

      if (abort.signal.aborted) {
        return;
      }

      const result = await runGeneration(image, abort);

      if (mounted.current && controller.current === abort && !abort.signal.aborted) {
        setVariants(result);
        setStatus(
          result.length === 1
            ? 'Le code est prêt. Vérifiez-le avant de l’importer.'
            : `${result.length} versions générées. Choisissez celle à importer.`,
        );
      }
    } catch (cause) {
      if (mounted.current && controller.current === abort && !abort.signal.aborted) {
        setStatus('');
        setLog([]);
        setError(cause instanceof Error ? clientError(cause.message) : 'La génération a échoué.');
      }
    } finally {
      if (mounted.current && controller.current === abort) {
        controller.current = null;
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
    setStatus('Lecture de l’image…');
    setLog([]);

    try {
      const image = validateScreenshot(await readImage(file));

      if (abort.signal.aborted) {
        return;
      }

      const result = await runGeneration(image, abort);

      if (mounted.current && controller.current === abort && !abort.signal.aborted) {
        setVariants(result);
        setStatus(
          result.length === 1
            ? 'Le code est prêt. Vérifiez-le avant de l’importer.'
            : `${result.length} versions générées. Choisissez celle à importer.`,
        );
      }
    } catch (cause) {
      if (mounted.current && controller.current === abort && !abort.signal.aborted) {
        setStatus('');
        setLog([]);
        setError(cause instanceof Error ? clientError(cause.message) : 'La génération a échoué.');
      }
    } finally {
      if (mounted.current && controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  };

  const importFile = async () => {
    const chosen = variants[selected];

    if (!chosen || busy) {
      return;
    }

    controller.current = null;
    setBusy(true);
    setError('');
    setStatus('Import dans Bolt…');
    setLog([]);

    try {
      validateImportableHtml(chosen.code);

      const path = await importCode(chosen.code);

      if (mounted.current) {
        setStatus(`Importé : ${path}. Demandez à Bolt de l’affiner dans la discussion.`);
      }
    } catch (cause) {
      if (mounted.current) {
        setStatus('');
        setLog([]);
        setError(cause instanceof Error ? clientError(cause.message) : 'L’import a échoué.');
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
    setError('');
    setLog([]);
    setStatus('Génération annulée. Vous pouvez réessayer.');
  };

  const downloadHtml = () => {
    const code = variants[selected]?.code;

    if (code === undefined) {
      return;
    }

    // Plain text avoids executing untrusted HTML when the downloaded file is opened.
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'screenshot-generated.html.txt';
    document.body.appendChild(anchor);

    try {
      anchor.click();
    } finally {
      anchor.remove();

      // Give the browser time to start the download before releasing the URL.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const current = variants[selected];
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
              className={classNames(
                'relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all',
                'disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-bolt-elements-borderColorActive bg-bolt-elements-background-depth-2 shadow-sm'
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
          <Label htmlFor="design-prompt">Quelle page souhaitez-vous créer ?</Label>
          <textarea
            id="design-prompt"
            aria-label="Description de la maquette"
            value={prompt}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Une page pour une boulangerie : accueil, trois produits, horaires, pied de page"
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
            className="self-start h-auto min-h-11 max-w-full !whitespace-normal bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
          >
            Générer {DESIGN_COUNT} maquettes
          </Button>

          {designs.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-bolt-elements-textSecondary">
                Choisissez la maquette à réaliser. Chacune propose une direction différente.
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
                        alt={`Aperçu de la maquette ${design.direction}`}
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
                className="self-start h-auto min-h-11 max-w-full !whitespace-normal bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
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
          <Label htmlFor="screenshot-image">Image de la capture</Label>
          <Input
            id="screenshot-image"
            aria-label="Image de la capture"
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
            className="self-start h-auto min-h-11 max-w-full !whitespace-normal bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
          >
            Transformer cette image en code
          </Button>
        </div>
      )}

      {/* ---- Shared output side ---- */}
      <Label htmlFor="screenshot-stack">Technologies de sortie</Label>
      <select
        id="screenshot-stack"
        aria-label="Technologies de sortie"
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
            L’aperçu est statique, sans scripts et isolé. Le code source n’est enregistré dans Bolt qu’après votre
            confirmation d’import.
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
                title={`Aperçu de la version ${selected + 1}`}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">${current.code}`}
                className="h-64 w-full rounded-md border border-bolt-elements-borderColor bg-white"
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
              <p id="html-download-help" className="text-xs text-bolt-elements-textSecondary">
                Téléchargez le code exact au format texte (.html.txt) pour le corriger dans un éditeur externe. Ce
                téléchargement n’écrit rien dans votre projet. Le code peut contenir des scripts : ne l’exécutez pas
                sans l’avoir vérifié.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={downloadHtml}
                aria-describedby="html-download-help"
                className="self-start"
              >
                Télécharger le HTML
              </Button>
              <Button
                type="button"
                onClick={() => void importFile()}
                disabled={busy}
                className="self-start h-auto min-h-11 max-w-full !whitespace-normal bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover text-bolt-elements-button-primary-text !rounded-full px-5"
              >
                Importer dans Bolt
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
