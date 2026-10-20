import type { MetaFunction } from 'react-router';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { MobileNav } from '~/components/mobile/MobileNav';
import { FirstRunOnboarding } from '~/components/onboarding/FirstRunOnboarding';
import { HeroGlow } from '~/components/ui/HeroGlow';

export const meta: MetaFunction = () => {
  return [{ title: 'Bolt' }, { name: 'description', content: 'Talk with Bolt, an AI assistant from StackBlitz' }];
};

export const loader = () => Response.json({});

/**
 * Landing page component for Bolt
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
/*
 * THE HEADER IS STICKY, like upstream bolt.diy. This is the user's explicit requirement and it
 * was measured wrong the first time it was "fixed".
 *
 * Earlier attempt: the page column was made the scroller (`overflow-y-auto` + `min-h-0`) and the
 * header was left in flow, on the theory that the bar must scroll away with the conversation.
 * Result on screen: scrolling a long chat carried the sidebar toggle, the logo and the chat title
 * off the top, and the only way back was to scroll up. Upstream keeps the bar pinned; so do we.
 *
 * Contract, each part is required:
 * - the bar lives in `sticky top-0`, INSIDE the page column so it pins to that scroller's top
 *   edge (a scroller cannot pin a child that sits outside it);
 * - `z-above-sidebar`: the sidebar is a `fixed` panel at z-index 997 and the bar must stay
 *   painted above it, and above the workbench;
 * - an OPAQUE background (`bg-bolt-elements-background-depth-1`, the page surface): a
 *   transparent sticky bar lets messages scroll through the labels;
 * - `shrink-0` keeps the 54px `--header-height`, a flex child in a column scroller is squeezed.
 *
 * The chat area below is `flex-1` and sizes on its content; the messages scroll inside
 * `StickToBottom`, so the bar stays put for the whole conversation.
 */
export default function Index() {
  return (
    <div className="has-sticky-header flex flex-col h-full min-h-0 w-full overflow-y-auto overflow-x-hidden bg-bolt-elements-background-depth-1">
      <HeroGlow />
      <div className="sticky top-0 z-above-sidebar shrink-0 bg-bolt-elements-background-depth-1">
        <Header />
      </div>
      <div className="flex flex-col flex-1">
        <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      </div>
      <ClientOnly>{() => <MobileNav />}</ClientOnly>
      <FirstRunOnboarding />
    </div>
  );
}
