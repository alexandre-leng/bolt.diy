import { describe, expect, it } from 'vitest';
import { loader } from './webcontainer.connect.$id';

const request = (url: string) => ({ request: new Request(url) }) as Parameters<typeof loader>[0];

describe('WebContainer connection route', () => {
  it('gives a directly opened URL a visible preview entry instead of a blank handshake', async () => {
    const response = await loader(request('https://bolt.example/webcontainer/connect/2ed8f36d'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Open preview');
    expect(html).toContain('/webcontainer/preview/2ed8f36d');
    expect(html).toContain('window.opener');
    expect(html).toContain('setupConnect');
  });

  it('does not reflect an arbitrary origin into executable HTML', async () => {
    const payload = "https://example.com/'</script><script>alert(1)</script>";
    const url = `https://bolt.example/webcontainer/connect/2ed8f36d?editorOrigin=${encodeURIComponent(payload)}`;
    const response = await loader(request(url));
    const html = await response.text();

    expect(html).not.toContain(payload);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('https://stackblitz.com');
  });

  it('rejects malformed preview IDs rather than embedding them into an HTML link', async () => {
    const response = await loader(request('https://bolt.example/webcontainer/connect/%3Cscript%3E'));

    expect(response.status).toBe(400);
  });
});
