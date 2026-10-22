import { type SelectHTMLAttributes, forwardRef } from 'react';
import { classNames } from '~/utils/classNames';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Renders the field in an invalid state (red border), for a refused value. */
  invalid?: boolean;
}

/*
 * One dropdown geometry for every settings form.
 *
 * Native <select> elements drawn with `appearance: auto` do not belong to the product: Chromium
 * paints its own grey gradient and a small bevel arrow, Firefox and Safari paint a different
 * control again, and on the dark theme the light UA surface made the field look like a stray
 * disabled input between two themed ones. Measured on the live Voice tab: the field held the
 * right colours but kept `appearance: auto`, so the arrow was the platform's, not ours.
 *
 * The rule here is the one already used by the reasoning-level control in Cloud Providers:
 * turn the native chrome off, draw a single caret with an icon layer, keep the text truncating so
 * a long model name never widens the column. The <select> stays a real <select>: the platform
 * list, keyboard support and mobile pickers keep working.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid = false, children, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={classNames(
            'w-full min-h-11 cursor-pointer appearance-none truncate rounded-lg py-2 pl-3 pr-10 text-sm',
            'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
            'text-bolt-elements-textPrimary transition-colors',
            'hover:border-bolt-elements-borderColorActive',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
            'disabled:cursor-not-allowed disabled:opacity-60',
            invalid ? 'border-red-500' : undefined,
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <span
          aria-hidden="true"
          className="i-ph:caret-down pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bolt-elements-textSecondary"
        />
      </div>
    );
  },
);

Select.displayName = 'Select';

export default Select;
