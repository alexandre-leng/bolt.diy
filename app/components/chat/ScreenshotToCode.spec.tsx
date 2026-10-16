import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';

const generated = '<!doctype html><html><body><h1>OK</h1></body></html>';

it('selects a screenshot, streams status and imports only when explicitly confirmed', async () => {
  let complete!: (code: string) => void;

  const generate = vi.fn((_image: string, options?: { onProgress?: (status: string) => void }) => {
    options?.onProgress?.('Generating code...');
    return new Promise<string>((resolve) => {
      complete = resolve;
    });
  });

  const importCode = vi.fn().mockResolvedValue('/home/project/screenshot-generated.html');
  render(<ScreenshotToCode generate={generate} importCode={importCode} />);

  const input = screen.getByLabelText('Screenshot image');
  const file = new File(['image bytes'], 'example.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText('example.png')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Generate HTML' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveProperty('textContent', 'Generating code...'));
  expect(importCode).not.toHaveBeenCalled();
  await act(async () => complete(generated));
  expect(screen.getByText(/review the generated HTML/i)).toBeTruthy();
  expect(importCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import HTML into Bolt' }));
  expect(await screen.findByRole('status')).toHaveProperty(
    'textContent',
    expect.stringContaining('screenshot-generated.html'),
  );
  expect(importCode).toHaveBeenCalledWith(generated);
});

describe('screenshot selection', () => {
  it('keeps real-looking Tailwind CDN generation as reviewable source without importing automatically', async () => {
    const realistic =
      '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script><style>body{color:#333}</style></head><body><img src="https://example.org/hero.png" alt="hero"></body></html>';

    const importCode = vi.fn();
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(realistic)} importCode={importCode} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate HTML' }));
    expect(await screen.findByDisplayValue(realistic)).toBeTruthy();
    expect(importCode).not.toHaveBeenCalled();
  });

  it('prevents importing active generated HTML while preserving it in the review textarea', async () => {
    const active = '<!doctype html><html><body><script>alert(1)</script></body></html>';
    const importCode = vi.fn();
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(active)} importCode={importCode} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate HTML' }));
    expect(await screen.findByDisplayValue(active)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Import HTML into Bolt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('active content'));
    expect(importCode).not.toHaveBeenCalled();
  });

  it('previews a generated HTML document in an opaque-origin sandbox before importing', async () => {
    const realistic =
      '<!doctype html><html><head><style>body{color:#333}</style></head><body><h1>Snapshot</h1></body></html>';
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(realistic)} importCode={vi.fn()} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate HTML' }));

    const frame = await screen.findByTitle('Generated screenshot preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Snapshot</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  });

  it('retains review of active source while rendering it only in a scriptless sandbox', async () => {
    const active = '<!doctype html><html><body><script>parent.postMessage("x","*")</script><h1>Safe</h1></body></html>';
    render(<ScreenshotToCode generate={vi.fn().mockResolvedValue(active)} importCode={vi.fn()} />);
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate HTML' }));

    const frame = await screen.findByTitle('Generated screenshot preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Safe</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'");
  });

  it('keeps the screenshot preview available after a successful import', async () => {
    render(
      <ScreenshotToCode
        generate={vi.fn().mockResolvedValue(generated)}
        importCode={vi.fn().mockResolvedValue('/home/project/screenshot-generated.html')}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText('Screenshot image'),
      new File(['image bytes'], 'example.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate HTML' }));
    await screen.findByTitle('Generated screenshot preview');
    await userEvent.click(screen.getByRole('button', { name: 'Import HTML into Bolt' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Imported'));
    expect(screen.getByTitle('Generated screenshot preview')).toBeTruthy();
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
    await userEvent.click(screen.getByRole('button', { name: 'Generate HTML' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Screenshot service connection failed.');
    expect(screen.queryByRole('button', { name: 'Import HTML into Bolt' })).toBeNull();
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
