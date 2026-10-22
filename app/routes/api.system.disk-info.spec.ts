import { describe, expect, it } from 'vitest';
import { loader } from './api.system.disk-info';

/*
 * `execSync` used to be assigned from a literal `{ execSync: null }`, so it was ALWAYS null:
 * production returned the "not available in this environment" placeholder and development
 * returned hard-coded mock disks. The real `df -k` parsing was unreachable dead code. With the
 * real `node:child_process` import, the loader on this Linux runner must return real disks.
 */
describe('/api/system/disk-info', () => {
  it('returns real disk data on Node, not the unavailable placeholder', async () => {
    const response = (await loader({
      request: new Request('https://bolt.example/api/system/disk-info', { headers: { 'X-Bolt-User-Admin': 'true' } }),
    } as never)) as Response;

    const disks = (await response.json()) as Array<{ filesystem: string; size: number; error?: string }>;

    expect(Array.isArray(disks)).toBe(true);
    expect(disks.length).toBeGreaterThan(0);

    // Before: the single entry was filesystem 'N/A' with this exact error string.
    expect(disks[0].error).toBeUndefined();
    expect(disks[0].filesystem).not.toBe('N/A');

    // Real `df` output means a non-zero size parsed from the command.
    expect(disks.some((disk) => disk.size > 0)).toBe(true);
  });

  it('does not return the development mock disks', async () => {
    const response = (await loader({
      request: new Request('https://bolt.example/api/system/disk-info', { headers: { 'X-Bolt-User-Admin': 'true' } }),
    } as never)) as Response;

    const disks = (await response.json()) as Array<{ filesystem: string }>;

    expect(disks.map((disk) => disk.filesystem)).not.toContain('MockDisk');
  });
});
