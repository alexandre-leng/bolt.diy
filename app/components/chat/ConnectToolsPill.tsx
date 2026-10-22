import { requestOpenSettings } from '~/components/mobile/MobileNav';

/*
 * Lovable's "Connect all your tools" pill above the landing title. Opens the
 * settings panel on Connectors (GitHub, Netlify, Vercel, Supabase...).
 */
const TOOL_ICONS = ['i-ph:github-logo-fill', 'i-ph:rocket-launch-fill', 'i-ph:database-fill'];

export function ConnectToolsPill() {
  return (
    <button
      type="button"
      data-testid="connect-tools-pill"
      aria-label="Connecter vos outils"
      onClick={() => requestOpenSettings('connectors')}
      className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-[#eceae4] dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-md py-1.5 pl-1.5 pr-3.5 text-sm text-[#1c1c1c] dark:text-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:bg-white dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 animate-fade-in"
    >
      <span className="flex -space-x-1.5" aria-hidden="true">
        {TOOL_ICONS.map((icon) => (
          <span
            key={icon}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white dark:border-[#1f1f22] bg-[#f3f2ee] dark:bg-white/15 text-[0.8rem]"
          >
            <span className={icon} />
          </span>
        ))}
      </span>
      Connecter vos outils
      <span className="i-ph:arrow-right text-base" aria-hidden="true" />
    </button>
  );
}
