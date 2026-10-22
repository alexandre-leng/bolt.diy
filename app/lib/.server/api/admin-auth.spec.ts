import { describe, expect, it } from 'vitest';
import { requireAdmin } from './admin-auth';

describe('requireAdmin', () => {
  it('denies missing and non-admin claims', () => {
    expect(requireAdmin(new Request('https://bolt.example'))?.status).toBe(403);
    expect(
      requireAdmin(new Request('https://bolt.example', { headers: { 'X-Bolt-User-Admin': 'false' } }))?.status,
    ).toBe(403);
  });
  it('allows a proxy-injected admin claim', () => {
    expect(
      requireAdmin(new Request('https://bolt.example', { headers: { 'X-Bolt-User-Admin': 'true' } })),
    ).toBeUndefined();
  });
});
