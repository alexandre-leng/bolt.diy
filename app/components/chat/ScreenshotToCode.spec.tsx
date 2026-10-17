import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';
import type { GenerationOptions, Variant } from '~/lib/screenshot/generate';

const generated = '<!doctype html><html><body><h1>OK</h1></body></html>';

/** The backend returns a LIST of variants; a one-variant result is the common case. */
const oneVariant = (code: string): Variant[] => [{ index: 0, code }];

it('selects a screenshot, streams status and imports only when explicitly confirmed', async () => {
  let complete!: (variants: Variant[]) => void;
  let emit!: (event: unknown) => void;

  const generate = vi.fn((_image: string, options?: GenerationOptions) => {
    emit = options?.onEvent as (event: unknown) => void;

    return new Promise<Variant[]>((resolve) => {
      complete = resolve;
    });
  });

  const importCode = vi.fn().mockResolvedValue('/home/project/screenshot-generated.html');
  render(<ScreenshotToCode generate={generate} importCode={importCode} />);

  const input = screen.getByLabelText('Screenshot image');
  const file = new File(['image bytes'], 'example.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText('example.png')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Generate design' }));

  /*
   * The real backend emits frames AFTER the socket opens, asynchronously. Emitting
   * synchronously from the mock would land before the component can register state.
   *
   * Stream frames feed the progress LOG (that is where reasoning and tool calls show);
   * the status line stays on its own lifecycle ("Reading screenshot..." -> summary).
   */
  await waitFor(() => expect(generate).toHaveBeenCalled());
  await act(async () => {
    emit({ kind: 'status', text: 'Generating code...' });
  });
  await waitFor(() => expect(screen.getByLabelText('Generation progress').textContent).toContain('Generating code'));
  expect(importCode).not.toHaveBeenCalled();
  await act(async () => complete(oneVariant(generated)));

  /*
   * The review notice and the import button now both mention "design", so match the
   * notice on its own distinctive wording to avoid a multi-element match.
   */
  expect(screen.getByText(/scriptless rendering in an isolated frame/i)).toBeTruthy();
  expect(importCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import this design into Bolt' }));
  expect(await screen.findByRole('status')).toHaveProperty(
    'textContent',
    expect.stringContaining('screenshot-generated.html'),
  );
  expect(importCode).toHaveBeenCalledWith(generated);
});

describe('variant selection', () => {
  const designs: Variant[] = [
    { index: 0, code: '<!doctype html><html><body><h1>First</h1></body></html>' },
    { index: 1, code: '<!doctype html><html><body><h1>Second</h1></body></html>' },
    { index: 2, code: '<!doctype html><html><body><h1>Third</h1></body></html>' },
  ];

  it('shows every generated design and imports the one the user picked', async () => {
    const importCode = vi.fn().mockResolvedValue('/home/project/picked.html');
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(designs)} importCode={importCode} />);

    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));

    // All three designs are offered, not only the last one that completed.
    expect(await screen.findByRole('button', { name: 'Design 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Design 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Design 3' })).toBeTruthy();

    // The first design is shown by default.
    expect(screen.getByTitle('Generated design 1 preview').getAttribute('srcdoc')).toContain('<h1>First</h1>');

    // Picking the third one switches the preview and is what gets imported.
    await userEvent.click(screen.getByRole('button', { name: 'Design 3' }));
    expect(screen.getByTitle('Generated design 3 preview').getAttribute('srcdoc')).toContain('<h1>Third</h1>');

    await userEvent.click(screen.getByRole('button', { name: 'Import this design into Bolt' }));
    expect(importCode).toHaveBeenCalledWith(designs[2].code);
  });

  it('reports how many designs were generated', async () => {
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(designs)} importCode={vi.fn()} />);

    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));

    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('3 designs'));
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

    render(<ScreenshotToCode generate={generate} importCode={vi.fn()} />);

    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));

    const log = await screen.findByLabelText('Generation progress');
    expect(log.textContent).toContain('4 designs');
    expect(log.textContent).toContain('Considering the hero layout');
    expect(log.textContent).toContain('create_file');
  });

  it('sends the selected output stack', async () => {
    const generate = vi.fn().mockResolvedValue(oneVariant(generated));
    render(<ScreenshotToCode generate={generate} importCode={vi.fn()} />);

    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Output stack'), 'react_tailwind');
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));

    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('data:image/png'),
      expect.objectContaining({ stack: 'react_tailwind' }),
    );
  });
});

describe('screenshot selection', () => {
  it('keeps real-looking Tailwind CDN generation as reviewable source without importing automatically', async () => {
    const realistic =
      '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script><style>body{color:#333}</style></head><body><img src="https://example.org/hero.png" alt="hero"></body></html>';

    const importCode = vi.fn();
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(oneVariant(realistic))} importCode={importCode} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));
    expect(await screen.findByDisplayValue(realistic)).toBeTruthy();
    expect(importCode).not.toHaveBeenCalled();
  });

  it('prevents importing active generated HTML while preserving it in the review textarea', async () => {
    const active = '<!doctype html><html><body><script>alert(1)</script></body></html>';
    const importCode = vi.fn();
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(oneVariant(active))} importCode={importCode} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));
    expect(await screen.findByDisplayValue(active)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Import this design into Bolt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('active content'));
    expect(importCode).not.toHaveBeenCalled();
  });

  it('previews a generated HTML document in an opaque-origin sandbox before importing', async () => {
    const realistic =
      '<!doctype html><html><head><style>body{color:#333}</style></head><body><h1>Snapshot</h1></body></html>';
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(oneVariant(realistic))} importCode={vi.fn()} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));

    const frame = await screen.findByTitle('Generated design 1 preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Snapshot</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  });

  it('retains review of active source while rendering it only in a scriptless sandbox', async () => {
    const active = '<!doctype html><html><body><script>parent.postMessage("x","*")</script><h1>Safe</h1></body></html>';
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(oneVariant(active))} importCode={vi.fn()} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));

    const frame = await screen.findByTitle('Generated design 1 preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Safe</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  });

  it('keeps the screenshot preview available after a successful import', async () => {
    render(
      <ScreenshotToCode
        generate={vi.fn().mockResolvedValue(oneVariant(generated))}
        importCode={vi.fn().mockResolvedValue('/home/project/screenshot-generated.html')}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));
    await screen.findByTitle('Generated design 1 preview');
    await userEvent.click(screen.getByRole('button', { name: 'Import this design into Bolt' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Imported'));
    expect(screen.getByTitle('Generated design 1 preview')).toBeTruthy();
  });

  it('retains an actionable error when the backend is unavailable', async () => {
    render(
      <ScreenshotToCode
        generate={vi.fn().mockRejectedValue(new Error('Screenshot service connection failed.'))}
        importCode={vi.fn()}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate design' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Screenshot service connection failed.');
    expect(screen.queryByRole('button', { name: 'Import this design into Bolt' })).toBeNull();
  });

  it('rejects unsupported files before opening a socket', async () => {
    const generate = vi.fn();
    render(<ScreenshotToCode generate={generate} importCode={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Screenshot image'), {
      target: { files: [new File(['data'], 'not.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('PNG, JPEG, or WebP'),
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
