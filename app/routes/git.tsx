import type { LoaderFunctionArgs } from 'react-router';
import type { MetaFunction } from 'react-router';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { GitUrlImport } from '~/components/git/GitUrlImport.client';
import { Header } from '~/components/header/Header';
import { HeroGlow } from '~/components/ui/HeroGlow';

export const meta: MetaFunction = () => {
  return [{ title: 'Bolt' }, { name: 'description', content: 'Talk with Bolt, an AI assistant from StackBlitz' }];
};

export async function loader(args: LoaderFunctionArgs) {
  return Response.json({ url: args.params.url });
}

export default function Index() {
  return (
    <div className="has-sticky-header flex flex-col h-full w-full overflow-y-auto overflow-x-hidden bg-bolt-elements-background-depth-1">
      <HeroGlow />
      {/*
       * STICKY, same contract as the landing route (see app/routes/_index.tsx): `sticky top-0`
       * inside the page scroller, `z-above-sidebar`, and an OPAQUE page surface so content
       * never scrolls through the labels.
       */}
      <div className="sticky top-0 z-above-sidebar shrink-0 bg-bolt-elements-background-depth-1">
        <Header />
      </div>
      <ClientOnly fallback={<BaseChat />}>{() => <GitUrlImport />}</ClientOnly>
    </div>
  );
}
