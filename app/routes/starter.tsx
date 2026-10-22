import type { MetaFunction } from 'react-router';
import { ClientOnly } from 'remix-utils/client-only';
import { StarterTemplateImport } from '~/components/chat/StarterTemplateImport.client';
import { Header } from '~/components/header/Header';
import { HeroGlow } from '~/components/ui/HeroGlow';
import { LoadingOverlay } from '~/components/ui/LoadingOverlay';

export const meta: MetaFunction = () => [{ title: 'Start a blank app | Bolt' }];

export default function Starter() {
  return (
    <div className="has-sticky-header flex flex-col h-full min-h-0 w-full overflow-y-auto overflow-x-hidden bg-bolt-elements-background-depth-1">
      <HeroGlow />
      {/* STICKY, see app/routes/_index.tsx for the contract. */}
      <div className="sticky top-0 z-above-sidebar shrink-0 bg-bolt-elements-background-depth-1">
        <Header />
      </div>
      <ClientOnly fallback={<LoadingOverlay message="Loading starter template..." />}>
        {() => <StarterTemplateImport />}
      </ClientOnly>
    </div>
  );
}
