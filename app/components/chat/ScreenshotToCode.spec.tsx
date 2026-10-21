import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';
import type { Design } from '~/lib/screenshot/designs';
import type { GenerationOptions, Variant } from '~/lib/screenshot/generate';
import { workbenchStore } from '~/lib/stores/workbench';

const generated = '<!doctype html><html><body><h1>OK</h1></body></html>';

/** The backend returns a LIST of variants; a one-variant result is the common case. */
const oneVariant = (code: string): Variant[] => [{ index: 0, code }];

/** No mockups: lets a test inspect the chrome without triggering a generation. */
const noDesigns = async () => [] as Design[];

/** The panel opens on design mode; tests that target the image path switch first. */
async function useImageMode() {
  await userEvent.click(screen.getByRole('radio', { name: 'Utiliser une image' }));
}

function renderPanel(props: Partial<Parameters<typeof ScreenshotToCode>[0]> = {}) {
  return render(<ScreenshotToCode designFor={noDesigns} importCode={vi.fn()} {...props} />);
}

describe('mode selection', () => {
  it('offers both starting points as visible, mutually exclusive options', () => {
    renderPanel();

    const designMode = screen.getByRole('radio', { name: 'Générer un design' });
    const imageMode = screen.getByRole('radio', { name: 'Utiliser une image' });

    expect(designMode).toBeTruthy();
    expect(imageMode).toBeTruthy();

    // Design mode is the default: describe a page, do not hunt for a file.
    expect(designMode.getAttribute('aria-checked')).toBe('true');
    expect(imageMode.getAttribute('aria-checked')).toBe('false');
  });

  it('switches which inputs are shown when the other mode is picked', async () => {
    renderPanel();

    // Design mode shows the prompt, not the file picker.
    expect(screen.getByLabelText('Description du design')).toBeTruthy();
    expect(screen.queryByLabelText('Image de capture')).toBeNull();

    await useImageMode();

    expect(screen.getByLabelText('Image de capture')).toBeTruthy();
    expect(screen.queryByLabelText('Description du design')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Utiliser une image' }).getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the output stack selector available in both modes', async () => {
    renderPanel();
    expect(screen.getByLabelText('Stack de sortie')).toBeTruthy();

    await useImageMode();
    expect(screen.getByLabelText('Stack de sortie')).toBeTruthy();
  });

  /*
   * A <button> with no fill keeps the UA grey (rgb(239,239,239)) and the light-mode text on top
   * made the unchecked card look like a disabled white block. Both cards must name their surface.
   */
  it('gives each mode card its own surface instead of the browser default', () => {
    renderPanel();

    for (const name of ['Générer un design', 'Utiliser une image']) {
      const card = screen.getByRole('radio', { name });

      expect(card.className).toContain('bg-bolt-elements-background-depth-3');
      expect(card.className).toMatch(/\btext-bolt-elements-textPrimary\b/);
    }

    // The active card takes the accent tint: depth-4 is a 7% white, too close to depth-3 to read.
    expect(screen.getByRole('radio', { name: 'Générer un design' }).className).toMatch(
      /(?<!hover:)\bbg-bolt-elements-item-backgroundAccent\b/,
    );
    expect(screen.getByRole('radio', { name: 'Utiliser une image' }).className).not.toMatch(
      /(?<!hover:)\bbg-bolt-elements-item-backgroundAccent\b/,
    );
  });

  it('does not paint a card with the dialog surface itself', () => {
    renderPanel();

    for (const name of ['Générer un design', 'Utiliser une image']) {
      expect(screen.getByRole('radio', { name }).className).not.toMatch(/\bbg-bolt-elements-background-depth-2\b/);
    }
  });
});

describe('design mode', () => {
  const mockups: Design[] = [
    { image: 'data:image/png;base64,aGVsbG8=', direction: 'Minimaliste' },
    { image: 'data:image/png;base64,d29ybGQ=', direction: 'Affirmé' },
    { image: 'data:image/png;base64,dGVzdA==', direction: 'Chaleureux' },
  ];

  it('turns a prompt into selectable mockups', async () => {
    const designFor = vi.fn().mockResolvedValue(mockups);
    renderPanel({ designFor });

    await userEvent.type(screen.getByLabelText('Description du design'), 'A bakery landing page');
    await userEvent.click(screen.getByRole('button', { name: /Générer 3 maquettes/ }));

    expect(await screen.findByRole('radio', { name: 'Maquette Minimaliste' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Maquette Affirmé' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Maquette Chaleureux' })).toBeTruthy();
    expect(designFor).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A bakery landing page', count: 3 }));
  });

  it('refuses an empty prompt before spending any generation', () => {
    const designFor = vi.fn();
    renderPanel({ designFor });

    expect(screen.getByRole('button', { name: /Générer 3 maquettes/ })).toHaveProperty('disabled', true);
    expect(designFor).not.toHaveBeenCalled();
  });

  it('sends the chosen mockup through the very same pipeline as an uploaded image', async () => {
    // One pipeline, two entry points: the mockup becomes an image, then gets generated.
    const generate = vi.fn().mockResolvedValue(oneVariant(generated));
    renderPanel({ designFor: vi.fn().mockResolvedValue(mockups), generate });

    await userEvent.type(screen.getByLabelText('Description du design'), 'A bakery landing page');
    await userEvent.click(screen.getByRole('button', { name: /Générer 3 maquettes/ }));
    await screen.findByRole('radio', { name: 'Maquette Affirmé' });

    await userEvent.click(screen.getByRole('radio', { name: 'Maquette Affirmé' }));
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette maquette en code' }));

    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(expect.stringContaining('data:image/'), expect.anything()),
    );
    expect(await screen.findByDisplayValue(generated)).toBeTruthy();
  });
});

describe('screenshot mode', () => {
  it('selects a screenshot and imports only when explicitly confirmed', async () => {
    let complete!: (variants: Variant[]) => void;

    const generate = vi.fn((_image: string, _options?: GenerationOptions) => {
      return new Promise<Variant[]>((resolve) => {
        complete = resolve;
      });
    });

    const importCode = vi.fn().mockResolvedValue('/home/project/screenshot-generated.html');
    renderPanel({ generate, importCode });
    await useImageMode();

    fireEvent.change(screen.getByLabelText('Image de capture'), {
      target: { files: [new File(['image bytes'], 'example.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('example.png')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    /*
     * The real backend emits frames AFTER the socket opens, asynchronously; emitting
     * synchronously from the mock would land before the component registers state.
     */
    await waitFor(() => expect(generate).toHaveBeenCalled());
    expect(importCode).not.toHaveBeenCalled();
    await act(async () => complete(oneVariant(generated)));
    expect(importCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('screenshot-generated.html'),
    );
    expect(importCode).toHaveBeenCalledWith(generated);
  });

  it('sends the selected output stack', async () => {
    const generate = vi.fn().mockResolvedValue(oneVariant(generated));
    renderPanel({ generate });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Stack de sortie'), 'react_tailwind');
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        expect.stringContaining('data:image/png'),
        expect.objectContaining({ stack: 'react_tailwind' }),
      ),
    );
  });

  it('rejects unsupported files before opening a socket', async () => {
    const generate = vi.fn();
    renderPanel({ generate });
    await useImageMode();

    fireEvent.change(screen.getByLabelText('Image de capture'), {
      target: { files: [new File(['data'], 'not.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('PNG, JPEG ou WebP'),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports how many versions were generated', async () => {
    const versions: Variant[] = [
      { index: 0, code: '<!doctype html><html><body><h1>A</h1></body></html>' },
      { index: 1, code: '<!doctype html><html><body><h1>B</h1></body></html>' },
      { index: 2, code: '<!doctype html><html><body><h1>C</h1></body></html>' },
    ];

    renderPanel({ generate: vi.fn().mockResolvedValue(versions) });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    /*
     * The status line also carries the intermediate "Reading the image...", so wait for
     * the final summary rather than for the element to exist.
     */
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('3 versions'));
  });
});

describe('variant selection', () => {
  const versions: Variant[] = [
    { index: 0, code: '<!doctype html><html><body><h1>First</h1></body></html>' },
    { index: 1, code: '<!doctype html><html><body><h1>Second</h1></body></html>' },
    { index: 2, code: '<!doctype html><html><body><h1>Third</h1></body></html>' },
  ];

  it('shows every generated version and imports the one the user picked', async () => {
    const importCode = vi.fn().mockResolvedValue('/home/project/picked.html');
    renderPanel({ generate: vi.fn().mockResolvedValue(versions), importCode });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    // All three are offered, not only the last one that completed.
    expect(await screen.findByRole('button', { name: 'Version 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version 3' })).toBeTruthy();

    expect(screen.getByTitle('Aperçu de la version 1').getAttribute('srcdoc')).toContain('<h1>First</h1>');

    await userEvent.click(screen.getByRole('button', { name: 'Version 3' }));
    expect(screen.getByTitle('Aperçu de la version 3').getAttribute('srcdoc')).toContain('<h1>Third</h1>');

    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(importCode).toHaveBeenCalledWith(versions[2].code);
  });
});

describe('streamed progress', () => {
  it('shows the backend reasoning and tool frames instead of a single frozen status', async () => {
    // A generation runs for minutes; without these lines the panel looks stuck.
    const generate = vi.fn(async (_image: string, options?: GenerationOptions) => {
      options?.onEvent?.({ kind: 'variantCount', count: 4 });
      options?.onEvent?.({ kind: 'thinking', text: 'Considering the hero layout' });
      options?.onEvent?.({ kind: 'toolStart', name: 'create_file' });

      return oneVariant(generated);
    });

    renderPanel({ generate });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    const log = await screen.findByLabelText('Progression de la génération');
    expect(log.textContent).toContain('4 versions');
    expect(log.textContent).toContain('Considering the hero layout');
    expect(log.textContent).toContain('create_file');
  });

  it('retains an actionable error when the backend is unavailable', async () => {
    renderPanel({ generate: vi.fn().mockRejectedValue(new Error('Screenshot service connection failed.')) });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Connexion au service de génération impossible. Réessayez.',
    );
    expect(screen.queryByRole('button', { name: 'Importer dans Bolt' })).toBeNull();
  });
});

describe('interactive import and lifecycle regressions', () => {
  const interactive =
    '<!doctype html><html><body><div id="root"></div><script src="https://unpkg.com/react/umd/react.production.min.js"></script><script type="text/babel">ReactDOM.createRoot(document.getElementById("root")).render(<h1>Bonjour</h1>);</script></body></html>';

  async function generateImage() {
    await useImageMode();
    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    await screen.findByTitle('Aperçu de la version 1');
  }

  it('requires consent per variant, preserves Babel source, and keeps previews scriptless', async () => {
    const importCode = vi.fn().mockResolvedValue('/home/project/index.html');
    renderPanel({
      generate: vi.fn().mockResolvedValue([
        { index: 0, code: interactive },
        { index: 1, code: interactive + '\n' },
      ]),
      importCode,
    });
    await generateImage();
    expect(screen.getByRole('button', { name: 'Importer dans Bolt' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/React n’est pas rendu/)).toBeTruthy();
    expect(screen.getByTitle('Aperçu de la version 1').getAttribute('sandbox')).toBe('');
    await userEvent.click(screen.getByRole('checkbox', { name: 'J’autorise l’import du code interactif' }));
    await userEvent.click(screen.getByRole('button', { name: 'Version 2' }));
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: 'Importer dans Bolt' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('button', { name: 'Version 1' }));
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true);
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(importCode).toHaveBeenCalledWith(interactive, { allowScripts: true });
  });

  it('retains downloadable source after import fails and collapses source details', async () => {
    renderPanel({
      generate: vi.fn().mockResolvedValue(oneVariant(generated)),
      importCode: vi.fn().mockRejectedValue(new Error('Disque indisponible')),
    });
    await generateImage();
    expect(screen.getByLabelText('Source HTML générée').closest('details')).toHaveProperty('open', false);
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Disque indisponible');

    const download = screen.getByRole('link', { name: 'Télécharger le HTML' });
    expect(decodeURIComponent(download.getAttribute('href') || '')).toContain(generated);
    expect(download.getAttribute('download')).toBe('version-1.html');
  });

  it('survives StrictMode effect replay and invalidates generated code on stack change', async () => {
    render(
      <StrictMode>
        <ScreenshotToCode generate={vi.fn().mockResolvedValue(oneVariant(generated))} importCode={vi.fn()} />
      </StrictMode>,
    );
    await generateImage();
    await userEvent.selectOptions(screen.getByLabelText('Stack de sortie'), 'react_tailwind');
    expect(screen.queryByTitle('Aperçu de la version 1')).toBeNull();
  });

  it('aggregates token fragments by type instead of dropping whitespace or rendering words as rows', async () => {
    renderPanel({
      generate: vi.fn(async (_image, options) => {
        options?.onEvent?.({ kind: 'assistant', text: 'Bonjour ' });
        options?.onEvent?.({ kind: 'thinking', text: 'Je ' });
        options?.onEvent?.({ kind: 'assistant', text: 'Alex' });
        options?.onEvent?.({ kind: 'thinking', text: 'réfléchis' });

        return oneVariant(generated);
      }),
    });
    await generateImage();

    const lines = within(screen.getByLabelText('Progression de la génération')).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('Bonjour Alex');
    expect(lines[1].textContent).toContain('Je réfléchis');
  });

  it('continues with the exact imported source only after an explicit click and invalidates on variant change', async () => {
    const onContinue = vi.fn();
    const path = '/home/project/imported.html';
    renderPanel({
      generate: vi.fn().mockResolvedValue([
        { index: 0, code: generated },
        { index: 1, code: generated + '\n' },
      ]),
      importCode: vi.fn().mockResolvedValue(path),
      onContinue,
    });
    await generateImage();
    expect(screen.queryByRole('button', { name: 'Continuer avec Bolt' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(onContinue).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Continuer avec Bolt' }));
    expect(onContinue).toHaveBeenCalledExactlyOnceWith(generated, path);
    await userEvent.click(screen.getByRole('button', { name: 'Version 2' }));
    expect(screen.queryByRole('button', { name: 'Continuer avec Bolt' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Version 1' }));
    expect(screen.queryByRole('button', { name: 'Continuer avec Bolt' })).toBeNull();
  });

  it('refuses importing into a different project even when code generation finishes later', async () => {
    const importCode = vi.fn();

    let complete!: (variants: Variant[]) => void;

    const generate = vi.fn(
      () =>
        new Promise<Variant[]>((resolve) => {
          complete = resolve;
        }),
    );

    const original = workbenchStore.projectGeneration.get();
    renderPanel({ generate, importCode });
    await useImageMode();
    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    await waitFor(() => expect(generate).toHaveBeenCalled());

    try {
      workbenchStore.projectGeneration.set(original + 1);
      await act(async () => complete(oneVariant(generated)));
      await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        expect.stringContaining('Le projet a changé'),
      );
      expect(importCode).not.toHaveBeenCalled();
      expect(screen.getByRole('link', { name: 'Télécharger le HTML' })).toBeTruthy();
    } finally {
      workbenchStore.projectGeneration.set(original);
    }
  });

  it('bounds progress to 60 readable rows and separates indexed token streams', async () => {
    renderPanel({
      generate: vi.fn(async (_image, options) => {
        for (let index = 0; index < 80; index++) {
          options?.onEvent?.({ kind: 'status', text: `Étape ${index}` });
        }

        const emit = options?.onEvent as
          ((event: { kind: 'assistant'; text: string; variantIndex: number }) => void) | undefined;
        emit?.({ kind: 'assistant', text: 'Bonjour ', variantIndex: 0 });
        emit?.({ kind: 'assistant', text: 'Autre version', variantIndex: 1 });
        emit?.({ kind: 'assistant', text: 'Alex', variantIndex: 0 });

        return oneVariant(generated);
      }),
    });
    await generateImage();

    const lines = within(screen.getByLabelText('Progression de la génération')).getAllByRole('listitem');
    expect(lines).toHaveLength(60);
    expect(lines[58].textContent).toBe('Version 1 · Assistant : Bonjour Alex');
    expect(lines[59].textContent).toBe('Version 2 · Assistant : Autre version');
    expect(await screen.findByAltText('Image sélectionnée')).toBeTruthy();
  });

  it('uses arrows to select and focus the other entry card', () => {
    renderPanel();

    const design = screen.getByRole('radio', { name: 'Générer un design' });
    design.focus();
    fireEvent.keyDown(design, { key: 'ArrowRight' });

    const image = screen.getByRole('radio', { name: 'Utiliser une image' });
    expect(image.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(image);
  });

  it('cancels immediately, ignores late completion, and permits another generation', async () => {
    let complete!: (variants: Variant[]) => void;

    const generate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Variant[]>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue(oneVariant(generated));
    renderPanel({ generate });
    await useImageMode();
    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('status').textContent).toContain('annulée');
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    await screen.findByTitle('Aperçu de la version 1');
    await act(async () => complete(oneVariant(interactive)));
    expect(screen.getByLabelText('Source HTML générée')).toHaveProperty('value', generated);
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });

  it('preserves earlier progressive mockups and invalidates code when choosing another', async () => {
    const designs: Design[] = [
      { image: 'data:image/png;base64,aGVsbG8=', direction: 'Minimaliste' },
      { image: 'data:image/png;base64,d29ybGQ=', direction: 'Affirmé' },
    ];

    let complete!: (result: Design[]) => void;
    renderPanel({
      generate: vi.fn().mockResolvedValue(oneVariant(generated)),
      designFor: vi.fn(async (options) => {
        options.onDesign?.(designs[0], 0, 1, 2);
        options.onDesign?.(designs[1], 1, 2, 2);

        return new Promise<Design[]>((resolve) => {
          complete = resolve;
        });
      }),
    });
    await userEvent.type(screen.getByLabelText('Description du design'), 'Une boulangerie');
    await userEvent.click(screen.getByRole('button', { name: /Générer 3 maquettes/ }));
    expect(screen.getByRole('radio', { name: 'Maquette Minimaliste' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Maquette Affirmé' })).toBeTruthy();
    await act(async () => complete(designs));
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette maquette en code' }));
    await screen.findByTitle('Aperçu de la version 1');
    await userEvent.click(screen.getByRole('radio', { name: 'Maquette Affirmé' }));
    expect(screen.queryByTitle('Aperçu de la version 1')).toBeNull();
  });
});

describe('preview safety', () => {
  it('renders generated HTML only in an opaque-origin, scriptless sandbox', async () => {
    const active = '<!doctype html><html><body><script>parent.postMessage("x","*")</script><h1>Safe</h1></body></html>';
    renderPanel({ generate: vi.fn().mockResolvedValue(oneVariant(active)) });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    const frame = await screen.findByTitle('Aperçu de la version 1');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Safe</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  });

  it('prevents importing active generated HTML without consent while preserving its source', async () => {
    const active = '<!doctype html><html><body><a href="javascript:alert(1)">go</a></body></html>';
    const importCode = vi.fn();
    renderPanel({ generate: vi.fn().mockResolvedValue(oneVariant(active)), importCode });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    expect(await screen.findByDisplayValue(active)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(screen.getByRole('button', { name: 'Importer dans Bolt' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('checkbox', { name: 'J’autorise l’import du code interactif' })).toHaveProperty(
      'checked',
      false,
    );
    expect(importCode).not.toHaveBeenCalled();
  });

  it('keeps the preview available after a successful import', async () => {
    renderPanel({
      generate: vi.fn().mockResolvedValue(oneVariant(generated)),
      importCode: vi.fn().mockResolvedValue('/home/project/screenshot-generated.html'),
    });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    await screen.findByTitle('Aperçu de la version 1');
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Fichier importé'));
    expect(screen.getByTitle('Aperçu de la version 1')).toBeTruthy();
  });
});
