import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPreferences, pushPreferences, readLocalPreferences, syncPreferences } from './preferences';

/*
 * Preferences must survive a device change, and a broken server must never take the UI down
 * with it. These tests pin both: the values that travel, and the soft-failure behaviour.
 */
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('preferences', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('reads the values this browser holds', () => {
    localStorage.setItem('bolt_theme', 'dark');
    localStorage.setItem('tool_access_mode', 'full-access');
    localStorage.setItem('bolt_interface_options', JSON.stringify({ language: 'fr', accentIntensity: 50 }));

    const values = readLocalPreferences();

    expect(values.theme).toBe('dark');
    expect(values.toolAccessMode).toBe('full-access');
    expect(values.language).toBe('fr');
  });

  it('does not send keys the server would reject', async () => {
    const spy = vi.fn(() => jsonResponse({ ok: true, preferences: {} }));
    vi.stubGlobal('fetch', spy);

    await pushPreferences({ theme: 'dark', unknownKey: 'x' } as never);

    const body = JSON.parse((spy.mock.calls[0] as never as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ theme: 'dark' });
    expect(body.unknownKey).toBeUndefined();
  });

  it('skips the request entirely when there is nothing to send', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    const ok = await pushPreferences({ unknownKey: 'x' } as never);

    expect(ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('applies server preferences to the browser', () => {
    localStorage.setItem('bolt_theme', 'light');

    const changed = applyPreferences({ theme: 'dark' });

    expect(changed).toBe(true);
    expect(localStorage.getItem('bolt_theme')).toBe('dark');
  });

  it('keeps the other interface options when only the language arrives', () => {
    localStorage.setItem('bolt_interface_options', JSON.stringify({ accentIntensity: 30, cornerRadius: 'round' }));

    applyPreferences({ language: 'fr' });

    const parsed = JSON.parse(localStorage.getItem('bolt_interface_options') as string);
    expect(parsed.language).toBe('fr');
    expect(parsed.accentIntensity).toBe(30); // not clobbered
    expect(parsed.cornerRadius).toBe('round');
  });

  it('reports no change when the values already match', () => {
    localStorage.setItem('bolt_theme', 'dark');

    expect(applyPreferences({ theme: 'dark' })).toBe(false);
  });

  it("seeds the account with this browser's choices on first run", async () => {
    localStorage.setItem('bolt_theme', 'dark');

    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push([url, init]);

        return Promise.resolve(jsonResponse({ ok: true, preferences: {} }));
      }),
    );

    const result = await syncPreferences();

    expect(result).toBe('seeded');

    const put = calls.find(([, init]) => init?.method === 'PUT');
    expect(put).toBeDefined();
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ theme: 'dark' });
  });

  it('pulls the account values down and reports it applied them', async () => {
    // No persisted local choice: the account preference is adopted.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true, preferences: { theme: 'dark' } }))),
    );

    const result = await syncPreferences();

    expect(result).toBe('synced');
    expect(localStorage.getItem('bolt_theme')).toBe('dark');
  });

  it('reports offline instead of throwing when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('offline');
      }),
    );

    const result = await syncPreferences();

    expect(result).toBe('offline');
  });

  it('reports offline on a non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}, 401))),
    );

    expect(await syncPreferences()).toBe('offline');
  });

  it('never overwrites a local value the account does not know about', async () => {
    localStorage.setItem('bolt_theme', 'dark');
    localStorage.setItem('tool_access_mode', 'full-access');

    // The account only knows the theme: the tool mode must survive untouched.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true, preferences: { theme: 'dark' } }))),
    );

    await syncPreferences();

    expect(localStorage.getItem('tool_access_mode')).toBe('full-access');
  });
});
