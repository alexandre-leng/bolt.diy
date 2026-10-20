import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { classNames } from '~/utils/classNames';

export type ActionButtonTone = 'primary' | 'secondary';

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ActionButtonTone;
}

/*
 * A themed action button for the settings forms.
 *
 * The bug this replaces was not a colour choice, it was an inherited surface: a bare <button>
 * with only border/text utilities still paints the browser's own button background, which is
 * `rgb(239, 239, 239)` — light grey. Measured on the live Voice tab, "Tester la transcription"
 * rendered as a solid light block with `color: rgb(10, 10, 10)` on the dark theme: a big grey
 * rectangle in a dark card, which reads as "this control is disabled" even though it is enabled.
 * The same happened to both eye buttons of the API-key fields (32x32 grey squares).
 *
 * Both tones therefore set their surface EXPLICITLY, never inherit one. `min-h-11` keeps the
 * 44px touch target, and the disabled state is the only thing allowed to look disabled.
 */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ className, tone = 'secondary', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={classNames(
          'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          tone === 'primary'
            ? 'border border-transparent bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover'
            : 'border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-item-backgroundActive',
          className,
        )}
        {...props}
      />
    );
  },
);

ActionButton.displayName = 'ActionButton';

export default ActionButton;
