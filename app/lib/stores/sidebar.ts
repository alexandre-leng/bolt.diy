import { atom } from 'nanostores';

/*
 * Whether the left sidebar (chat history) is expanded.
 *
 * Lifted out of `Menu.client.tsx` so the header toggle, the panel's close
 * button and the hover trigger share one source of truth (the header icon used
 * to be a decorative <div> with no access to the Menu's private state).
 *
 * Default is CLOSED, like bolt.new / Lovable: the prompt owns the landing page.
 * An explicit user choice (header toggle, close button) is remembered in
 * localStorage; the transient hover-to-open at the left edge is not, so moving
 * the mouse past the edge never changes what the next visit shows.
 */
export const SIDEBAR_STORAGE_KEY = 'bolt_sidebar_open';

export const sidebarOpenStore = atom<boolean>(false);

function remember(open: boolean) {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_STORAGE_KEY, open ? 'true' : 'false');
  } catch {
    // Private mode / storage disabled: the choice simply is not remembered.
  }
}

/** Saved explicit choice, or `undefined` when the user never chose. */
export function readSavedSidebarOpen(): boolean | undefined {
  try {
    const saved = globalThis.localStorage?.getItem(SIDEBAR_STORAGE_KEY);

    if (saved === 'true') {
      return true;
    }

    return saved === 'false' ? false : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Initial state after mount: touch devices always start closed (the 340px panel
 * would cover the chat); otherwise the saved choice, else closed.
 */
export function initSidebar(isTouch: boolean) {
  sidebarOpenStore.set(isTouch ? false : (readSavedSidebarOpen() ?? false));
}

/** Transient open (hover at the left edge): not remembered. */
export function peekSidebar() {
  sidebarOpenStore.set(true);
}

/** Transient close (hover leaves the panel): not remembered. */
export function unpeekSidebar() {
  sidebarOpenStore.set(false);
}

export function openSidebar() {
  sidebarOpenStore.set(true);
  remember(true);
}

export function closeSidebar() {
  sidebarOpenStore.set(false);
  remember(false);
}

export function toggleSidebar() {
  if (sidebarOpenStore.get()) {
    closeSidebar();
  } else {
    openSidebar();
  }
}
