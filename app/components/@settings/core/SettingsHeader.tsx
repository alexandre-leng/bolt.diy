import { forwardRef } from 'react';
import { classNames } from '~/utils/classNames';

interface SettingsHeaderProps {
  /** Leaf view title, e.g. "Connectors". Omitted on the settings home. */
  title?: string;

  /** True on a phone, inside a category: the control then walks back to the category list. */
  showingSection: boolean;
  onBack: () => void;
  onClose: () => void;
}

/**
 * The settings panel's title bar: one control that always means "one step back", and one that
 * always means "close".
 *
 * Before this bar existed the panel drew a lone "Retour au projet" button at `mt-4` inside the
 * sidebar column, while the app header (logo + panel toggle) is a SEPARATE layer painted above
 * it (`z-above-sidebar`). On a phone the two collided: measured at 390x844, the header's logo
 * occupied y 12..38 and the button's own box started at y 17, so the wordmark was printed over
 * the top edge of the button and the back arrow sat underneath the toggle's X — two different
 * actions drawn in the same 48px band.
 *
 * The bar owns a top inset that clears the header, states the panel's name (it used to show no
 * title at all on a phone), and carries a back control whose target changes with the view
 * instead of duplicating a "leave settings" action that the X already performs.
 */
export const SettingsHeader = forwardRef<HTMLDivElement, SettingsHeaderProps>(
  ({ title, showingSection, onBack, onClose }, ref) => {
    const backLabel = showingSection ? 'Retour à tous les réglages' : 'Retour au projet';

    return (
      <div
        ref={ref}
        data-testid="settings-header"
        className="mb-4 flex items-center gap-2 border-b border-bolt-elements-borderColor pb-3"
      >
        <button
          type="button"
          onClick={onBack}
          data-testid="settings-back"
          className={classNames(
            'flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg bg-transparent px-2 text-sm text-bolt-elements-textSecondary',
            'transition-colors hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
          )}
          aria-label={backLabel}
          title={backLabel}
        >
          <span className="i-ph:arrow-left h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Retour</span>
        </button>

        <h1
          className="min-w-0 flex-1 truncate text-base font-semibold text-bolt-elements-textPrimary"
          data-testid="settings-title"
        >
          {title ?? 'Réglages'}
        </h1>

        <button
          type="button"
          onClick={onClose}
          data-testid="settings-close"
          className={classNames(
            'flex min-h-11 min-w-11 items-center justify-center rounded-lg text-bolt-elements-textSecondary',
            'transition-colors hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
          )}
          aria-label="Fermer les réglages"
          title="Fermer les réglages"
        >
          <span className="i-ph:x h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    );
  },
);

SettingsHeader.displayName = 'SettingsHeader';

export default SettingsHeader;
