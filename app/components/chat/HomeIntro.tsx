import { useStore } from '@nanostores/react';
import type { UIMessage } from 'ai';
import GitCloneButton from './GitCloneButton';
import { ImportFolderButton } from '~/components/chat/ImportFolderButton';
import { ImportZipButton } from '~/components/chat/ImportZipButton';
import { profileStore } from '~/lib/stores/profile';
import { classNames } from '~/utils/classNames';

/*
 * Landing screen copy, in French like the rest of the interface (audit A-03: the hero, the
 * subtitle, « or import » and the group's aria-label were still English in production).
 * Kept in one module so a spec can pin every visible string and accessible name.
 */
export const HOME_COPY = {
  titleWithName: (name: string) => `Qu’allez-vous créer, ${name} ?`,
  titleDefault: 'Qu’allez-vous créer aujourd’hui ?',
  subtitle: 'Décrivez votre application et Bolt la construit, en direct, dans votre navigateur.',
  importLead: 'ou importer',
  importGroupLabel: 'Importer un projet existant',
} as const;

/*
 * Lovable greets the user by name. Client-only (the profile lives in
 * localStorage), so the server render shows the generic title.
 */
export function HomeHeroTitle() {
  const profile = useStore(profileStore);
  const name = profile?.username?.trim();

  return <>{name ? HOME_COPY.titleWithName(name) : HOME_COPY.titleDefault}</>;
}

export function HomeHeroText() {
  return (
    <>
      <h1 className="text-[2rem] leading-[1.1] sm:text-5xl font-semibold tracking-[-0.03em] text-bolt-elements-textPrimary mb-3 animate-fade-in">
        <HomeHeroTitle />
      </h1>
      <p className="text-base sm:text-lg mb-8 text-bolt-elements-textSecondary animate-fade-in animation-delay-200">
        {HOME_COPY.subtitle}
      </p>
    </>
  );
}

/*
 * Secondary landing actions (import folder / ZIP / clone) as quiet ghost
 * buttons, so they do not compete with the prompt. `!` overrides the default
 * Button styles, since classNames() concatenates instead of merging.
 */
const SECONDARY_ACTION = classNames(
  '!h-8 !min-w-0 !px-2.5 !py-1 !gap-1.5 !text-sm !font-normal !rounded-lg',

  // Sits on the landing wash: near-black / near-white text keeps AA contrast on the pink band.
  '!bg-transparent !border-transparent !text-[#1c1c1c] dark:!text-white',
  'hover:!bg-white/60 dark:hover:!bg-white/10',
  'focus-visible:!outline focus-visible:!outline-2 focus-visible:!outline-accent-500',
);

interface HomeImportActionsProps {
  importChat?: (description: string, messages: UIMessage[]) => Promise<void>;
}

export function HomeImportActions({ importChat }: HomeImportActionsProps) {
  return (
    <div
      className="flex flex-wrap justify-center items-center gap-1 text-sm text-[#1c1c1c]/80 dark:text-white/80"
      aria-label={HOME_COPY.importGroupLabel}
      role="group"
    >
      <span className="mr-1">{HOME_COPY.importLead}</span>
      <ImportFolderButton importChat={importChat} className={SECONDARY_ACTION} />
      <ImportZipButton importChat={importChat} className={SECONDARY_ACTION} />
      <GitCloneButton importChat={importChat} className={SECONDARY_ACTION} />
    </div>
  );
}
