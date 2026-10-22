import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';
import type { Design } from '~/lib/screenshot/designs';
import type { GenerationOptions, Variant } from '~/lib/screenshot/generate';

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

    const designMode = screen.getByRole('radio', { name: 'Créer une maquette' });
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
    expect(screen.getByLabelText('Description de la maquette')).toBeTruthy();
    expect(screen.queryByLabelText('Image de la capture')).toBeNull();

    await useImageMode();

    expect(screen.getByLabelText('Image de la capture')).toBeTruthy();
    expect(screen.queryByLabelText('Description de la maquette')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Utiliser une image' }).getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the output stack selector available in both modes', async () => {
    renderPanel();
    expect(screen.getByLabelText('Technologies de sortie')).toBeTruthy();

    await useImageMode();
    expect(screen.getByLabelText('Technologies de sortie')).toBeTruthy();
  });
});

describe('design mode', () => {
  const mockups: Design[] = [
    { image: 'data:image/png;base64,aGVsbG8=', direction: 'Minimal' },
    { image: 'data:image/png;base64,d29ybGQ=', direction: 'Bold' },
    { image: 'data:image/png;base64,dGVzdA==', direction: 'Friendly' },
  ];

  it('turns a prompt into selectable mockups', async () => {
    const designFor = vi.fn().mockResolvedValue(mockups);
    renderPanel({ designFor });

    await userEvent.type(screen.getByLabelText('Description de la maquette'), 'A bakery landing page');
    await userEvent.click(screen.getByRole('button', { name: /Générer 3 maquettes/ }));

    expect(await screen.findByRole('radio', { name: 'Maquette Minimal' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Maquette Bold' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Maquette Friendly' })).toBeTruthy();
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

    await userEvent.type(screen.getByLabelText('Description de la maquette'), 'A bakery landing page');
    await userEvent.click(screen.getByRole('button', { name: /Générer 3 maquettes/ }));
    await screen.findByRole('radio', { name: 'Maquette Bold' });

    await userEvent.click(screen.getByRole('radio', { name: 'Maquette Bold' }));
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

    fireEvent.change(screen.getByLabelText('Image de la capture'), {
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
      screen.getByLabelText('Image de la capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Technologies de sortie'), 'react_tailwind');
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('data:image/png'),
      expect.objectContaining({ stack: 'react_tailwind' }),
    );
  });

  it('rejects unsupported files before opening a socket', async () => {
    const generate = vi.fn();
    renderPanel({ generate });
    await useImageMode();

    fireEvent.change(screen.getByLabelText('Image de la capture'), {
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
      screen.getByLabelText('Image de la capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    /*
     * The status line also carries the intermediate "Lecture de l’image…", so wait for
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
      screen.getByLabelText('Image de la capture'),
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
      screen.getByLabelText('Image de la capture'),
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
      screen.getByLabelText('Image de la capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'La connexion au service de génération a échoué.',
    );
    expect(screen.queryByRole('button', { name: 'Importer dans Bolt' })).toBeNull();
  });
});

describe('preview safety', () => {
  it('renders generated HTML only in an opaque-origin, scriptless sandbox', async () => {
    const active = '<!doctype html><html><body><script>parent.postMessage("x","*")</script><h1>Safe</h1></body></html>';
    renderPanel({ generate: vi.fn().mockResolvedValue(oneVariant(active)) });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de la capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));

    const frame = await screen.findByTitle('Aperçu de la version 1');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Safe</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  });

  it('prevents importing active generated HTML while preserving it in the review textarea', async () => {
    const active = '<!doctype html><html><body><script>alert(1)</script></body></html>';
    const importCode = vi.fn();
    renderPanel({ generate: vi.fn().mockResolvedValue(oneVariant(active)), importCode });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de la capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    expect(await screen.findByDisplayValue(active)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('contenu actif'));
    expect(importCode).not.toHaveBeenCalled();
  });

  it('keeps the preview available after a successful import', async () => {
    renderPanel({
      generate: vi.fn().mockResolvedValue(oneVariant(generated)),
      importCode: vi.fn().mockResolvedValue('/home/project/screenshot-generated.html'),
    });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de la capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    await screen.findByTitle('Aperçu de la version 1');
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Importé'));
    expect(screen.getByTitle('Aperçu de la version 1')).toBeTruthy();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;

  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

async function uploadScreenshot() {
  await useImageMode();
  await userEvent.upload(
    screen.getByLabelText('Image de la capture'),
    new File(['image bytes'], 'example.png', { type: 'image/png' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
}

describe('truthful operation states', () => {
  it('validates an overlong prompt without generating, reporting progress or removing existing results', async () => {
    const designFor = vi.fn().mockResolvedValue([{ image: 'data:image/png;base64,aGVsbG8=', direction: 'Minimal' }]);
    const generate = vi.fn();
    renderPanel({ designFor, generate });
    fireEvent.change(screen.getByLabelText('Description de la maquette'), { target: { value: 'Une boulangerie' } });
    await userEvent.click(screen.getByRole('button', { name: 'Générer 3 maquettes' }));
    await screen.findByRole('radio', { name: 'Maquette Minimal' });
    designFor.mockClear();

    fireEvent.change(screen.getByLabelText('Description de la maquette'), { target: { value: 'x'.repeat(1501) } });
    await userEvent.click(screen.getByRole('button', { name: 'Générer 3 maquettes' }));

    expect(screen.getByRole('alert').textContent).toContain('1 500 caractères');
    expect(designFor).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('Progression de la génération')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Maquette Minimal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Générer 3 maquettes' })).toHaveProperty('disabled', false);
  });

  it.each(['Provider quota: account ABC', 'constructor', '__proto__'])(
    'preserves the provider error "%s" and clears design progress on rejection',
    async (message) => {
      renderPanel({ designFor: vi.fn().mockRejectedValue(new Error(message)) });
      fireEvent.change(screen.getByLabelText('Description de la maquette'), { target: { value: 'Une boulangerie' } });
      await userEvent.click(screen.getByRole('button', { name: 'Générer 3 maquettes' }));
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
    },
  );

  it('clears status and streamed progress after a screenshot provider rejection', async () => {
    renderPanel({
      generate: vi.fn(async (_image, options) => {
        options?.onEvent?.({ kind: 'status', text: 'Backend content unchanged' });
        throw new Error('Provider 429: try later');
      }),
    });
    await uploadScreenshot();
    expect((await screen.findByRole('alert')).textContent).toBe('Provider 429: try later');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('Progression de la génération')).toBeNull();
    expect(screen.getByRole('button', { name: 'Transformer cette image en code' })).toHaveProperty('disabled', false);
  });

  it('clears progress when the selected mockup cannot become code', async () => {
    renderPanel({
      designFor: vi.fn().mockResolvedValue([{ image: 'data:image/png;base64,aGVsbG8=', direction: 'Minimal' }]),
      generate: vi.fn().mockRejectedValue(new Error('Provider error: model unavailable')),
    });
    fireEvent.change(screen.getByLabelText('Description de la maquette'), { target: { value: 'Une boulangerie' } });
    await userEvent.click(screen.getByRole('button', { name: 'Générer 3 maquettes' }));
    await screen.findByRole('radio', { name: 'Maquette Minimal' });
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette maquette en code' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Provider error: model unavailable');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('Progression de la génération')).toBeNull();
  });

  it('cancels immediately, keeps a final French message and ignores an old run while a newer one is busy', async () => {
    const first = deferred<Design[]>();
    const second = deferred<Design[]>();
    const designFor = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPanel({ designFor });
    fireEvent.change(screen.getByLabelText('Description de la maquette'), { target: { value: 'Une boulangerie' } });
    await userEvent.click(screen.getByRole('button', { name: 'Générer 3 maquettes' }));

    const signal = designFor.mock.calls[0][0].signal;
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Génération annulée. Vous pouvez réessayer.');
    expect(screen.getByRole('button', { name: 'Générer 3 maquettes' })).toHaveProperty('disabled', false);

    await userEvent.click(screen.getByRole('button', { name: 'Générer 3 maquettes' }));
    await act(async () => first.reject(new Error('Old rejected run')));
    expect(screen.getByRole('button', { name: 'Générer 3 maquettes' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toBe('Génération des maquettes…');
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => second.resolve([]));
    expect(screen.getByRole('button', { name: 'Générer 3 maquettes' })).toHaveProperty('disabled', false);
  });

  it('does not let an old screenshot finally unlock a newer screenshot generation', async () => {
    const first = deferred<Variant[]>();
    const second = deferred<Variant[]>();
    const generate = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPanel({ generate });
    await uploadScreenshot();
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(generate.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Génération annulée');
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette image en code' }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await act(async () => first.resolve(oneVariant(generated)));
    expect(screen.getByRole('button', { name: 'Transformer cette image en code' })).toHaveProperty('disabled', true);
    expect(screen.queryByDisplayValue(generated)).toBeNull();
    await act(async () => second.resolve(oneVariant(generated)));
    expect(screen.getByRole('button', { name: 'Transformer cette image en code' })).toHaveProperty('disabled', false);
    expect(screen.getByDisplayValue(generated)).toBeTruthy();
  });

  it('cancels mockup-to-code generation without allowing its old completion to unlock a newer run', async () => {
    const first = deferred<Variant[]>();
    const second = deferred<Variant[]>();
    const generate = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPanel({
      generate,
      designFor: vi.fn().mockResolvedValue([{ image: 'data:image/png;base64,aGVsbG8=', direction: 'Minimal' }]),
    });
    fireEvent.change(screen.getByLabelText('Description de la maquette'), { target: { value: 'Une boulangerie' } });
    await userEvent.click(screen.getByRole('button', { name: 'Générer 3 maquettes' }));
    await screen.findByRole('radio', { name: 'Maquette Minimal' });
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette maquette en code' }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(generate.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Génération annulée');
    await userEvent.click(screen.getByRole('button', { name: 'Transformer cette maquette en code' }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await act(async () => first.reject(new Error('Old provider failure')));
    expect(screen.getByRole('button', { name: 'Transformer cette maquette en code' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => second.resolve(oneVariant(generated)));
    expect(screen.getByDisplayValue(generated)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Transformer cette maquette en code' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('never offers a fake cancel during import and clears progress after import rejection', async () => {
    const pending = deferred<string>();
    const importCode = vi.fn().mockReturnValue(pending.promise);
    renderPanel({ generate: vi.fn().mockResolvedValue(oneVariant(generated)), importCode });
    await uploadScreenshot();
    await screen.findByDisplayValue(generated);
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(screen.getByRole('status').textContent).toBe('Import dans Bolt…');
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Importer dans Bolt' })).toHaveProperty('disabled', true);
    await act(async () => pending.reject(new Error('Project write refused')));
    expect(screen.getByRole('alert').textContent).toBe('Project write refused');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Importer dans Bolt' })).toHaveProperty('disabled', false);
  });
});

describe('explicit safe HTML download', () => {
  it('rejects unsafe import without writes and downloads the exact selected, read-only source as plain text', async () => {
    const unsafe = '<!doctype html>\n<html><body><script>alert("é")</script><h1>À vérifier</h1></body></html>\n';
    const importCode = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue('blob:test-download');
    const revokeObjectURL = vi.fn();
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      renderPanel({
        generate: vi.fn().mockResolvedValue([
          { index: 0, code: generated },
          { index: 1, code: unsafe },
        ]),
        importCode,
      });
      await uploadScreenshot();
      await screen.findByRole('button', { name: 'Version 2' });
      await userEvent.click(screen.getByRole('button', { name: 'Version 2' }));

      const source = screen.getByLabelText('Source HTML générée') as HTMLTextAreaElement;
      expect(source.readOnly).toBe(true);
      expect(source.value).toBe(unsafe);
      await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
      expect(screen.getByRole('alert').textContent).toContain('contenu actif');
      expect(importCode).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByText(/Ce téléchargement n’écrit rien dans votre projet/)).toBeTruthy();
      expect(createObjectURL).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Télécharger le HTML' }));

      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('text/plain;charset=utf-8');

      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(blob);
      });
      expect(text).toBe(unsafe);

      const anchor = click.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe('screenshot-generated.html.txt');
      expect(anchor.href).toBe('blob:test-download');
      expect(anchor.isConnected).toBe(false);
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-download'), { timeout: 2000 });
      expect(importCode).not.toHaveBeenCalled();
      expect(source.value).toBe(unsafe);
    } finally {
      click.mockRestore();

      if (originalCreate) {
        Object.defineProperty(URL, 'createObjectURL', originalCreate);
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL');
      }

      if (originalRevoke) {
        Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
      } else {
        Reflect.deleteProperty(URL, 'revokeObjectURL');
      }
    }
  });
});
