import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusFirstAvailable, restoreFocus, restoreSettingsFocus, tryFocus } from './restoreFocus';

/*
 * A-08: closing the settings dialog left focus on <body> (100 ms .. 2.5 s, 390/768/1440 px).
 * The opener was a detached node (phone: the bottom navigation unmounts while the dialog is
 * open) or hidden (desktop: the side panel closes when the dialog opens).
 */

function button(testid: string, attrs: Record<string, string> = {}) {
  const element = document.createElement('button');
  element.dataset.testid = testid;
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));

  return element;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('tryFocus', () => {
  it('refuse un élément détaché, dans un sous-arbre inert/aria-hidden, et vérifie activeElement', () => {
    const detached = button('x');
    expect(tryFocus(detached)).toBe(false);

    const hidden = document.createElement('div');
    hidden.setAttribute('aria-hidden', 'true');

    const inside = button('y');
    hidden.appendChild(inside);
    document.body.appendChild(hidden);
    expect(tryFocus(inside)).toBe(false);

    const ok = button('z');
    document.body.appendChild(ok);
    expect(tryFocus(ok)).toBe(true);
    expect(document.activeElement).toBe(ok);
  });
});

describe('retour du focus à la fermeture des Réglages', () => {
  it('mobile : l’onglet ouvreur a été démonté, le focus va sur l’onglet Réglages remonté', async () => {
    vi.useFakeTimers();

    // The original tab, then the nav is unmounted while the dialog is open.
    const nav = document.createElement('nav');
    nav.dataset.testid = 'mobile-nav';

    const opener = button('', { 'data-tab': 'settings' });
    nav.appendChild(opener);
    document.body.appendChild(nav);
    nav.remove();

    // The header toggle is always there: it must NOT win while the tab is remounting.
    const toggle = button('sidebar-toggle');
    document.body.appendChild(toggle);

    const settled = vi.fn();
    restoreSettingsFocus(opener, { onSettled: settled });

    // The dialog close is committed, then the bottom navigation remounts with a NEW tab.
    await vi.advanceTimersByTimeAsync(20);

    const remounted = document.createElement('nav');
    remounted.dataset.testid = 'mobile-nav';

    const newTab = button('', { 'data-tab': 'settings' });
    remounted.appendChild(newTab);
    document.body.appendChild(remounted);

    await vi.advanceTimersByTimeAsync(200);

    expect(document.activeElement).toBe(newTab);
    expect(settled).toHaveBeenCalledWith(newTab);
  });

  it('bureau : l’ouvreur est dans le panneau masqué, le focus va sur le bouton du panneau de l’en-tête', async () => {
    vi.useFakeTimers();

    const panel = document.createElement('aside');
    panel.id = 'sidebar-panel';
    panel.setAttribute('inert', '');

    const opener = button('settings-button');
    panel.appendChild(opener);

    const toggle = button('sidebar-toggle');
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    restoreSettingsFocus(opener);
    await vi.advanceTimersByTimeAsync(10);
    expect(document.activeElement).toBe(document.body);

    // Nothing better appeared: the header toggle after a few attempts (~60 ms, before the 100 ms probe).
    await vi.advanceTimersByTimeAsync(200);
    expect(document.activeElement).toBe(toggle);
  });

  it('rend le focus à l’ouvreur lui-même quand il est encore disponible', async () => {
    vi.useFakeTimers();

    const opener = button('settings-button');
    const toggle = button('sidebar-toggle');
    document.body.appendChild(toggle);
    document.body.appendChild(opener);

    restoreSettingsFocus(opener);
    await vi.advanceTimersByTimeAsync(10);

    expect(document.activeElement).toBe(opener);
  });

  it('ne vole pas un focus déjà placé ailleurs par l’utilisateur', async () => {
    vi.useFakeTimers();

    const input = document.createElement('input');
    document.body.appendChild(input);

    const settled = vi.fn();

    // Nothing focusable yet: first attempt fails, then the user clicks into the field.
    restoreFocus([() => document.querySelector<HTMLElement>('[data-testid="later"]')], { onSettled: settled });
    await vi.advanceTimersByTimeAsync(10);
    input.focus();
    document.body.appendChild(button('later'));
    await vi.advanceTimersByTimeAsync(100);

    expect(document.activeElement).toBe(input);
    expect(settled).toHaveBeenCalledWith(input);
  });

  it('abandonne proprement après le nombre de tentatives', async () => {
    vi.useFakeTimers();

    const settled = vi.fn();
    restoreFocus([() => null], { attempts: 3, intervalMs: 10, onSettled: settled });
    await vi.advanceTimersByTimeAsync(100);

    expect(settled).toHaveBeenCalledWith(null);
    expect(focusFirstAvailable([null, undefined])).toBeNull();
  });
});
