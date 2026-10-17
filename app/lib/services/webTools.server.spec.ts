import { describe, expect, it } from 'vitest';
import { validatePublicHttpUrl } from './webTools.server';

describe('validatePublicHttpUrl', () => {
  it.each([
    'http://host.docker.internal:8200/history',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://bolt-history:8200/',
    'http://router.lan/',
    'http://nas.home.arpa/',
    'http://db.localdomain/',
  ])('blocks the internal name %s', (url) => {
    // Before: only literal IPs, localhost and .local were refused; these reached the network.
    expect(() => validatePublicHttpUrl(url)).toThrow(/Private, local, and reserved/);
  });

  it('still accepts public hosts and keeps the literal-address checks', () => {
    expect(validatePublicHttpUrl('https://example.com/page').hostname).toBe('example.com');
    expect(validatePublicHttpUrl('https://docs.internal-tools.example.org/').hostname).toBe(
      'docs.internal-tools.example.org',
    );
    expect(() => validatePublicHttpUrl('http://127.0.0.1/')).toThrow();
    expect(() => validatePublicHttpUrl('http://[::1]/')).toThrow();
  });
});
