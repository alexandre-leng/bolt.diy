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

  it('announces the project stack instead of asking for one', async () => {
    renderPanel();

    /*
     * No framework selector: the project is React + TypeScript + Tailwind + shadcn/ui, decided
     * once (or by a framework the user types in the prompt), like Lovable and Bolt.
     */
    expect(screen.queryByLabelText('Stack de sortie')).toBeNull();
    expect(screen.getByText(/React \+ TypeScript \+ Tailwind \+ shadcn\/ui/)).toBeTruthy();

    await useImageMode();

    expect(screen.queryByLabelText('Stack de sortie')).toBeNull();
  });

  /*
   * A <button> with no fill keeps the UA grey (rgb(239,239,239)) and the light-mode text on top
   * made the unchecked card look like a disabled white block. Both cards must name their surface.
   */
  it('gives each mode card its own surface instead of the browser default', () => {
    renderPanel();

    for (const name of ['Générer un design', 'Utiliser une image']) {
      const card = screen.getByRole('radio', { name });

      // Idle cards sit one step off the dialog (depth-2 panel -> depth-1 card).
      expect(card.className).toContain('bg-bolt-elements-background-depth-1');
      expect(card.className).toMatch(/\btext-bolt-elements-textPrimary\b/);
    }

    /*
     * The active card climbs one more step AND takes the accent border: the difference must be
     * visible without relying on the border alone (measured flat when it reused the idle depth).
     */
    const active = screen.getByRole('radio', { name: 'Générer un design' }).className;
    const idle = screen.getByRole('radio', { name: 'Utiliser une image' }).className;

    expect(active).toMatch(/(?<!hover:)\bbg-bolt-elements-background-depth-3\b/);
    expect(active).toContain('border-bolt-elements-borderColorActive');
    expect(idle).not.toMatch(/(?<!hover:)\bbg-bolt-elements-background-depth-3\b/);
    expect(idle).toContain('border-bolt-elements-borderColor ');
  });

  it('does not paint a card with the dialog surface itself', () => {
    renderPanel();

    for (const name of ['Générer un design', 'Utiliser une image']) {
      expect(screen.getByRole('radio', { name }).className).not.toMatch(
        /(?<!hover:)\bbg-bolt-elements-background-depth-2\b/,
      );
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
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

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
    fireEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

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
    expect(importCode).toHaveBeenCalledWith(generated, { allowScripts: false });
  });

  it('sends the fixed fallback stack when no project handler is wired', async () => {
    const generate = vi.fn().mockResolvedValue(oneVariant(generated));
    renderPanel({ generate });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

    /* The upload is read as a data URL, then handed to the flat-file pipeline. */
    await vi.waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        expect.stringContaining('data:image/png'),
        expect.objectContaining({ stack: 'html_tailwind' }),
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
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

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
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

    // All three are offered, not only the last one that completed.
    expect(await screen.findByRole('button', { name: 'Version 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version 3' })).toBeTruthy();

    expect(screen.getByTitle('Aperçu de la version 1').getAttribute('srcdoc')).toContain('<h1>First</h1>');

    await userEvent.click(screen.getByRole('button', { name: 'Version 3' }));
    expect(screen.getByTitle('Aperçu de la version 3').getAttribute('srcdoc')).toContain('<h1>Third</h1>');

    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(importCode).toHaveBeenCalledWith(versions[2].code, { allowScripts: false });
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
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

    const log = await screen.findByLabelText('Progression de la génération');
    expect(log.textContent).toContain('4 versions');
    expect(log.textContent).toContain('Considering the hero layout');
    expect(log.textContent).toContain('create_file');
  });

  it('retains an actionable error when the backend is unavailable', async () => {
    renderPanel({
      generate: vi.fn().mockRejectedValue(new Error('Connexion au service de génération impossible. Réessayez.')),
    });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Connexion au service de génération impossible. Réessayez.',
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
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));

    const frame = await screen.findByTitle('Aperçu de la version 1');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Safe</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  });

  it('prevents importing active generated HTML while preserving it in the review textarea', async () => {
    const active = '<!doctype html><html><body><a href="javascript:alert(1)">go</a></body></html>';
    const importCode = vi.fn();
    renderPanel({ generate: vi.fn().mockResolvedValue(oneVariant(active)), importCode });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Image de capture'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));
    expect(await screen.findByDisplayValue(active)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(await screen.findByRole('alertdialog')).toHaveProperty(
      'textContent',
      expect.stringContaining('Cette variante contient des scripts'),
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
    await userEvent.click(screen.getByRole('button', { name: /Créer le projet/ }));
    await screen.findByTitle('Aperçu de la version 1');
    await userEvent.click(screen.getByRole('button', { name: 'Importer dans Bolt' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Fichier importé'));
    expect(screen.getByTitle('Aperçu de la version 1')).toBeTruthy();
  });
});
