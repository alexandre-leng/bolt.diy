/*
 * Give focus back to a STABLE element after a dialog closes.
 *
 * Measured on the deployed build (A-08): closing the settings dialog (Escape or « Fermer »)
 * left `document.activeElement === body` from 100 ms to 2.5 s at 390, 768 and 1440 px, because
 * the element that opened the dialog was no longer focusable when we tried:
 *   - on a phone the bottom navigation is UNMOUNTED while the dialog is open, so the
 *     « Réglages » tab that opened it is a detached node; a new one mounts after the close;
 *   - on desktop the dialog closes the side panel when it opens, so the gear button in the
 *     panel is off-screen / hidden and the browser refuses to focus it.
 *
 * So the candidates are tried in order, and each attempt is VERIFIED (`activeElement` is the
 * element afterwards), because `focus()` on a hidden, inert or detached element is a silent
 * no-op. Attempts repeat for a few frames: the remounted bottom navigation only appears after
 * the dialog's close has been committed.
 */
export type FocusCandidate = HTMLElement | null | undefined | (() => HTMLElement | null | undefined);

export function tryFocus(element: HTMLElement | null | undefined): boolean {
  if (!element || !element.isConnected) {
    return false;
  }

  if (element.closest('[inert], [aria-hidden="true"], [hidden]')) {
    return false;
  }

  element.focus({ preventScroll: true });

  return element.ownerDocument.activeElement === element;
}

export function focusFirstAvailable(candidates: FocusCandidate[]): HTMLElement | null {
  for (const candidate of candidates) {
    const element = typeof candidate === 'function' ? candidate() : candidate;

    if (tryFocus(element)) {
      return element ?? null;
    }
  }

  return null;
}

export interface RestoreFocusOptions {
  /** How many attempts in total (one per `intervalMs`). */
  attempts?: number;
  intervalMs?: number;

  /**
   * Always-present targets used only once the preferred ones had `lastResortAfter` attempts
   * to appear (a remounted opener takes a frame or two), and on the final attempt.
   */
  lastResort?: FocusCandidate[];
  lastResortAfter?: number;

  /** Called with the element that took focus, or `null` when every attempt failed. */
  onSettled?: (element: HTMLElement | null) => void;
}

/**
 * Retry `focusFirstAvailable` until one candidate takes focus. Returns a cancel function.
 * Stops early if the user already moved focus somewhere real (not `body`).
 */
export function restoreFocus(candidates: FocusCandidate[], options: RestoreFocusOptions = {}): () => void {
  const { attempts = 15, intervalMs = 30, onSettled, lastResort = [], lastResortAfter = 3 } = options;

  let remaining = attempts;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const attempt = () => {
    if (cancelled) {
      return;
    }

    const active = document.activeElement;

    /*
     * Someone (the user, or a component on purpose) already placed focus: leave it there. Focus
     * still inside a dialog does not count, that dialog may be the one being torn down.
     */
    if (
      remaining < attempts &&
      active &&
      active !== document.body &&
      active !== document.documentElement &&
      !active.closest('[role="dialog"]')
    ) {
      onSettled?.(active as HTMLElement);
      return;
    }

    remaining--;

    const attemptsMade = attempts - remaining;
    const allowLastResort = attemptsMade >= lastResortAfter || remaining <= 0;
    const focused = focusFirstAvailable(allowLastResort ? [...candidates, ...lastResort] : candidates);

    if (focused) {
      onSettled?.(focused);
      return;
    }

    if (remaining <= 0) {
      onSettled?.(null);
      return;
    }

    timer = setTimeout(attempt, intervalMs);
  };

  timer = setTimeout(attempt, 0);

  return () => {
    cancelled = true;

    if (timer) {
      clearTimeout(timer);
    }
  };
}

/** Where focus goes back after the settings dialog closes, in order of preference. */
export function settingsReturnTargets(opener: HTMLElement | null | undefined): {
  candidates: FocusCandidate[];
  lastResort: FocusCandidate[];
} {
  return {
    candidates: [
      opener,

      // Phone: the bottom navigation's « Réglages » tab, remounted after the dialog closed.
      () => document.querySelector<HTMLElement>('[data-testid="mobile-nav"] button[data-tab="settings"]'),

      // Desktop: the gear in the side panel, when the panel is still visible.
      () => document.querySelector<HTMLElement>('#sidebar-panel [data-testid="settings-button"]'),
    ],

    // Always mounted: the header's panel toggle, which leads back to the gear.
    lastResort: [() => document.querySelector<HTMLElement>('[data-testid="sidebar-toggle"]')],
  };
}

/** Restore focus after the settings dialog closed. Returns a cancel function. */
export function restoreSettingsFocus(opener: HTMLElement | null | undefined, options: RestoreFocusOptions = {}) {
  const { candidates, lastResort } = settingsReturnTargets(opener);

  return restoreFocus(candidates, { lastResort, ...options });
}
