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
 * THE HEADER IS STICKY, on every page of the app. User's standing requirement, confirmed again
 * after a sibling session reverted it in the opposite direction: the bar stays pinned, it does not
 * scroll away with the content.
 *
 * If you are about to remove this because "the user asked for a non-sticky header", you are
 * reading an older instruction: the sticky contract wins, and this comment is the record of it.
 *
 * Contract on each route that mounts <Header /> (/, /settings, /starter, /git):
 * - the bar lives in `sticky top-0 z-above-sidebar shrink-0 bg-bolt-elements-background-depth-1`,
 *   INSIDE the page column (a scroller cannot pin a child that sits outside it);
 * - `z-above-sidebar` (998) keeps it above the fixed sidebar and the workbench, and
 *   `app/styles/z-index.scss` overrides that helper's `position: relative` so `sticky` really
 *   applies (measured: without it the wrapper computed `relative` and scrolled away);
 * - the opaque page surface stops messages scrolling through the labels;
 * - the column carries `.has-sticky-header` (4rem of bottom padding, `app/styles/index.scss`):
 *   a sticky element pins only while its containing block's whole area crosses the scrollport
 *   edge, so without it the bar leaves the top on the last screenful of a long conversation;
 * - `shrink-0` keeps the 54px `--header-height`, a flex child in a column scroller is squeezed.
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
