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
  await userEvent.click(screen.getByRole('radio', { name: 'Use an image' }));
}

function renderPanel(props: Partial<Parameters<typeof ScreenshotToCode>[0]> = {}) {
  return render(<ScreenshotToCode designFor={noDesigns} importCode={vi.fn()} {...props} />);
}

describe('mode selection', () => {
  it('offers both starting points as visible, mutually exclusive options', () => {
    renderPanel();

    const designMode = screen.getByRole('radio', { name: 'Generate a design' });
    const imageMode = screen.getByRole('radio', { name: 'Use an image' });

    expect(designMode).toBeTruthy();
    expect(imageMode).toBeTruthy();

    // Design mode is the default: describe a page, do not hunt for a file.
    expect(designMode.getAttribute('aria-checked')).toBe('true');
    expect(imageMode.getAttribute('aria-checked')).toBe('false');
  });

  it('switches which inputs are shown when the other mode is picked', async () => {
    renderPanel();

    // Design mode shows the prompt, not the file picker.
    expect(screen.getByLabelText('Design description')).toBeTruthy();
    expect(screen.queryByLabelText('Screenshot image')).toBeNull();

    await useImageMode();

    expect(screen.getByLabelText('Screenshot image')).toBeTruthy();
    expect(screen.queryByLabelText('Design description')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Use an image' }).getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the output stack selector available in both modes', async () => {
    renderPanel();
    expect(screen.getByLabelText('Output stack')).toBeTruthy();

    await useImageMode();
    expect(screen.getByLabelText('Output stack')).toBeTruthy();
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

    await userEvent.type(screen.getByLabelText('Design description'), 'A bakery landing page');
    await userEvent.click(screen.getByRole('button', { name: /Generate 3 mockups/ }));

    expect(await screen.findByRole('radio', { name: 'Minimal mockup' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bold mockup' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Friendly mockup' })).toBeTruthy();
    expect(designFor).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A bakery landing page', count: 3 }));
  });

  it('refuses an empty prompt before spending any generation', () => {
    const designFor = vi.fn();
    renderPanel({ designFor });

    expect(screen.getByRole('button', { name: /Generate 3 mockups/ })).toHaveProperty('disabled', true);
    expect(designFor).not.toHaveBeenCalled();
  });

  it('sends the chosen mockup through the very same pipeline as an uploaded image', async () => {
    // One pipeline, two entry points: the mockup becomes an image, then gets generated.
    const generate = vi.fn().mockResolvedValue(oneVariant(generated));
    renderPanel({ designFor: vi.fn().mockResolvedValue(mockups), generate });

    await userEvent.type(screen.getByLabelText('Design description'), 'A bakery landing page');
    await userEvent.click(screen.getByRole('button', { name: /Generate 3 mockups/ }));
    await screen.findByRole('radio', { name: 'Bold mockup' });

    await userEvent.click(screen.getByRole('radio', { name: 'Bold mockup' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn this mockup into code' }));

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

    fireEvent.change(screen.getByLabelText('Screenshot image'), {
      target: { files: [new File(['image bytes'], 'example.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('example.png')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));

    /*
     * The real backend emits frames AFTER the socket opens, asynchronously; emitting
     * synchronously from the mock would land before the component registers state.
     */
    await waitFor(() => expect(generate).toHaveBeenCalled());
    expect(importCode).not.toHaveBeenCalled();
    await act(async () => complete(oneVariant(generated)));
    expect(importCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import into Bolt' }));
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
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Output stack'), 'react_tailwind');
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));

    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('data:image/png'),
      expect.objectContaining({ stack: 'react_tailwind' }),
    );
  });

  it('rejects unsupported files before opening a socket', async () => {
    const generate = vi.fn();
    renderPanel({ generate });
    await useImageMode();

    fireEvent.change(screen.getByLabelText('Screenshot image'), {
      target: { files: [new File(['data'], 'not.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('PNG, JPEG, or WebP'),
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
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));

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
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));

    // All three are offered, not only the last one that completed.
    expect(await screen.findByRole('button', { name: 'Version 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version 3' })).toBeTruthy();

    expect(screen.getByTitle('Generated version 1 preview').getAttribute('srcdoc')).toContain('<h1>First</h1>');

    await userEvent.click(screen.getByRole('button', { name: 'Version 3' }));
    expect(screen.getByTitle('Generated version 3 preview').getAttribute('srcdoc')).toContain('<h1>Third</h1>');

    await userEvent.click(screen.getByRole('button', { name: 'Import into Bolt' }));
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
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));

    const log = await screen.findByLabelText('Generation progress');
    expect(log.textContent).toContain('4 versions');
    expect(log.textContent).toContain('Considering the hero layout');
    expect(log.textContent).toContain('create_file');
  });

  it('retains an actionable error when the backend is unavailable', async () => {
    renderPanel({ generate: vi.fn().mockRejectedValue(new Error('Screenshot service connection failed.')) });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Screenshot service connection failed.');
    expect(screen.queryByRole('button', { name: 'Import into Bolt' })).toBeNull();
  });
});

describe('preview safety', () => {
  it('renders generated HTML only in an opaque-origin, scriptless sandbox', async () => {
    const active = '<!doctype html><html><body><script>parent.postMessage("x","*")</script><h1>Safe</h1></body></html>';
    renderPanel({ generate: vi.fn().mockResolvedValue(oneVariant(active)) });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));

    const frame = await screen.findByTitle('Generated version 1 preview');
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
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));
    expect(await screen.findByDisplayValue(active)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Import into Bolt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('active content'));
    expect(importCode).not.toHaveBeenCalled();
  });

  it('keeps the preview available after a successful import', async () => {
    renderPanel({
      generate: vi.fn().mockResolvedValue(oneVariant(generated)),
      importCode: vi.fn().mockResolvedValue('/home/project/screenshot-generated.html'),
    });
    await useImageMode();

    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn this image into code' }));
    await screen.findByTitle('Generated version 1 preview');
    await userEvent.click(screen.getByRole('button', { name: 'Import into Bolt' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Imported'));
    expect(screen.getByTitle('Generated version 1 preview')).toBeTruthy();
  });
});
