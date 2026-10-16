import { describe, expect, it, vi } from 'vitest';
import { importScreenshotHtml } from './import';

const html = '<!doctype html><html><body><h1>Generated</h1></body></html>';

function project(files: Record<string, { type: 'file' | 'folder'; content?: string }> = {}) {
  return {
    files: { get: () => files },
    queueProjectMutation: async <T>(callback: () => Promise<T>) => callback(),
    createFile: vi.fn(async () => true),
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
    await expect(importScreenshotHtml(active, workbench)).rejects.toThrow(/active content/i);
    expect(workbench.createFile).not.toHaveBeenCalled();
  });

  it('preserves static CSS and images in a Bolt project', async () => {
    const workbench = project();

    const css =
      '<!doctype html><html><head><style>body{color:red}</style></head><body><img src="https://example.org/p.png"></body></html>';
    await importScreenshotHtml(css, workbench);
    expect(workbench.createFile).toHaveBeenCalledWith('/home/project/screenshot-generated.html', css);
  });

  it('does not report success if file creation fails', async () => {
    const workbench = project();
    workbench.createFile.mockResolvedValueOnce(false);
    await expect(importScreenshotHtml(html, workbench)).rejects.toThrow(/could not/i);
    expect(workbench.showWorkbench.set).not.toHaveBeenCalled();
  });
});
