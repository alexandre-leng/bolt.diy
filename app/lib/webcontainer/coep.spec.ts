import { describe, expect, it, vi } from 'vitest';
import { detectCoepMode } from './coep';
import { parsePreviewId, previewOrigin } from './coep';

const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 16; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0';
const FIREFOX_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

describe('detectCoepMode (must match the nginx $bolt_coep map)', () => {
  it('uses require-corp on Firefox for Android, which ignores credentialless', () => {
    expect(detectCoepMode(FIREFOX_ANDROID)).toBe('require-corp');
  });

  it('keeps credentialless elsewhere', () => {
    expect(detectCoepMode(FIREFOX_DESKTOP)).toBe('credentialless');
    expect(detectCoepMode(CHROME_ANDROID)).toBe('credentialless');
  });

  it('honours the bolt_coep test cookie', () => {
    expect(detectCoepMode(FIREFOX_DESKTOP, 'a=1; bolt_coep=rc')).toBe('require-corp');
    expect(detectCoepMode(FIREFOX_ANDROID, 'bolt_coep=cl; b=2')).toBe('credentialless');
    expect(detectCoepMode(FIREFOX_DESKTOP, 'xbolt_coep=rc')).toBe('credentialless');
  });
});

describe('preview host per isolation mode', () => {
  it('parses the preview id from both WebContainer hosts', () => {
    expect(parsePreviewId('https://abc123.local-credentialless.webcontainer-api.io/foo')).toBe('abc123');
    expect(parsePreviewId('https://abc123.local-corp.webcontainer-api.io')).toBe('abc123');
    expect(parsePreviewId('https://example.com')).toBeNull();
  });

  it('builds the host matching the mode', () => {
    expect(previewOrigin('abc', 'credentialless')).toBe('https://abc.local-credentialless.webcontainer-api.io');
    expect(previewOrigin('abc', 'require-corp')).toBe('https://abc.local-corp.webcontainer-api.io');
  });
});

/* Server runtime (bolt-runtime) previews: p<N> next to the app host (set per test). */
describe('server-runtime preview hosts', () => {
  const withHost = (hostname: string, run: () => void) => {
    vi.stubGlobal('location', { hostname });

    try {
      run();
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it('parses p<N> only on the app parent domain', () => {
    withHost('bolt.169-58-18-46.sslip.io', () => {
      expect(parsePreviewId('https://p3.169-58-18-46.sslip.io')).toBe('p3');
      expect(parsePreviewId('https://p12.169-58-18-46.sslip.io/about?x=1')).toBe('p12');
      expect(parsePreviewId('https://p3.evil.example/')).toBeNull();
      expect(parsePreviewId('https://p3x.169-58-18-46.sslip.io')).toBeNull();
    });
  });

  it('builds the origin of a server preview id', () => {
    withHost('bolt.169-58-18-46.sslip.io', () => {
      expect(previewOrigin('p7')).toBe('https://p7.169-58-18-46.sslip.io');
      expect(previewOrigin('abc', 'credentialless')).toBe('https://abc.local-credentialless.webcontainer-api.io');
    });
  });
});
