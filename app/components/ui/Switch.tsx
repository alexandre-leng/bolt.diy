import * as SwitchPrimitive from '@radix-ui/react-switch';
import { memo } from 'react';
import { classNames } from '~/utils/classNames';

/*
 * The track IS the switch: 36x20 with the thumb inside. A 44px box around a 16px dot read on the
 * deployed build as a grey pill holding an off-centre marble, which looks like a broken control.
 */
interface SwitchProps {
  className?: string;
  checked?: boolean;
  onCheckedChange?: (event: boolean) => void;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-labelledby'?: string;
  id?: string;
  disabled?: boolean;
}

export const Switch = memo(
  ({
    className,
    onCheckedChange,
    checked,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
    'aria-labelledby': ariaLabelledBy,
    id,
    disabled,
  }: SwitchProps) => {
    return (
      <SwitchPrimitive.Root
        className={classNames(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
          'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
          'transition-colors duration-200 ease-in-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[state=checked]:bg-accent-500 data-[state=checked]:border-accent-500',
          className,
        )}
        checked={checked}
        onCheckedChange={(e) => onCheckedChange?.(e)}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-labelledby={ariaLabelledBy}
        id={id}
        disabled={disabled}
      >
        <SwitchPrimitive.Thumb
          className={classNames(
            'block h-4 w-4 rounded-full bg-white',
            'shadow-sm shadow-black/20',
            'transition-transform duration-200 ease-in-out',
            'translate-x-0.5',
            'data-[state=checked]:translate-x-[1.125rem]',
            'will-change-transform',
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);
