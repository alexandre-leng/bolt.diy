import { create } from 'zustand';
import { pushPreferences } from '~/lib/preferences';

export type ToolAccessMode = 'full-access' | 'ask-for-all';

const TOOL_ACCESS_MODE_KEY = 'tool_access_mode';

/*
 * Full access is the DEFAULT: writing, running and testing project files happens without an
 * approval prompt, as in Lovable. An approval dialog in front of every edit makes the agent
 * stop mid-task and wait for a click; the user asked for that friction to be gone.
 *
 * The opt-out is preserved: a user who explicitly chose 'ask-for-all' keeps it. Only the
 * never-chosen state resolves to full access, so nobody is silently overridden.
 */
function getInitialMode(): ToolAccessMode {
  if (typeof window === 'undefined') {
    return 'full-access';
  }

  return window.localStorage.getItem(TOOL_ACCESS_MODE_KEY) === 'ask-for-all' ? 'ask-for-all' : 'full-access';
}

type ToolAccessStore = {
  mode: ToolAccessMode;
  setMode: (mode: ToolAccessMode) => void;
};

export const useToolAccessStore = create<ToolAccessStore>((set) => ({
  mode: getInitialMode(),
  setMode: (mode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOOL_ACCESS_MODE_KEY, mode);
    }

    set({ mode });

    /*
     * Same reasoning as the theme: this choice shapes what the agent asks for, so it should not
     * have to be made again on every device. Fire and forget.
     */
    void pushPreferences({ toolAccessMode: mode });
  },
}));
