import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePreviewId, previewOrigin } from './previewUrl';

describe('preview addresses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps pN hosts of the app domain both ways', () => {
    vi.stubGlobal('location', { hostname: 'bolt.169-58-18-46.sslip.io' });

    expect(parsePreviewId('https://p3.169-58-18-46.sslip.io/deep?x=1')).toBe('p3');
    expect(previewOrigin('p3')).toBe('https://p3.169-58-18-46.sslip.io');
  });

  it('refuses foreign or legacy StackBlitz addresses', () => {
    vi.stubGlobal('location', { hostname: 'bolt.169-58-18-46.sslip.io' });

    expect(parsePreviewId('https://p3.evil.example/')).toBeNull();
    expect(parsePreviewId('https://abc--5173--2ed8f36d.local-credentialless.webcontainer-api.io/')).toBeNull();
    expect(previewOrigin('abc--5173')).toBeNull();
  });
});
