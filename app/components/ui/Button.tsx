import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { classNames } from '~/utils/classNames';

/*
 * The `default` variant used `bg-bolt-elements-background`, which is NOT a class UnoCSS can
 * generate (the theme path is `bolt.elements.background.depth.N`, so only
 * `bg-bolt-elements-background-depth-N` compiles). The class was therefore absent from the
 * stylesheet, the `<button>` kept the browser's own `rgb(239,239,239)` surface, and the label
 * stayed `--bolt-elements-textPrimary` (#f8f8f2 in the dark theme): measured on Settings >
 * Compte, white text on a near-white button.
 *
 * Every variant now paints a depth that exists, one step ABOVE the panel it sits in
 * (`depth-2` panel -> `depth-3` fill), so a control is never the same colour as its container.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-4',
        destructive: 'bg-red-500 text-white hover:bg-red-600',
        outline:
          'border border-bolt-elements-borderColor bg-transparent text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary',
        secondary:
          'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
        ghost: 'bg-transparent text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
        link: 'bg-transparent text-bolt-elements-textPrimary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  _asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, _asChild = false, ...props }, ref) => {
    return <button className={classNames(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
