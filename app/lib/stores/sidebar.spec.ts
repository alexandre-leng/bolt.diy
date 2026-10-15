import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIDEBAR_STORAGE_KEY,
  closeSidebar,
  initSidebar,
  peekSidebar,
  readSavedSidebarOpen,
  sidebarOpenStore,
  toggleSidebar,
} from './sidebar';

describe('sidebar store', () => {
  beforeEach(() => {
    localStorage.clear();
    sidebarOpenStore.set(false);
  });

  it('starts closed when the user never chose', () => {
    initSidebar(false);
    expect(sidebarOpenStore.get()).toBe(false);
    expect(readSavedSidebarOpen()).toBeUndefined();
  });

  it('remembers an explicit toggle', () => {
    toggleSidebar();
    expect(sidebarOpenStore.get()).toBe(true);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');

    sidebarOpenStore.set(false);
    initSidebar(false);
    expect(sidebarOpenStore.get()).toBe(true);

    closeSidebar();
    initSidebar(false);
    expect(sidebarOpenStore.get()).toBe(false);
  });

  it('does not remember a hover peek', () => {
    peekSidebar();
    expect(sidebarOpenStore.get()).toBe(true);
    expect(readSavedSidebarOpen()).toBeUndefined();
  });

  it('always starts closed on touch devices', () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    initSidebar(true);
    expect(sidebarOpenStore.get()).toBe(false);
  });
});
