import { forwardRef } from 'react';
import { classNames } from '~/utils/classNames';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/*
 * The field paints a depth token that UnoCSS actually generates
 * (`bg-bolt-elements-background-depth-N`). The previous `bg-bolt-elements-background`,
 * `border-bolt-elements-border` and `ring-bolt-elements-ring` names are not valid theme paths,
 * so no rule was emitted: the input kept the browser's white field while its ink stayed
 * `--bolt-elements-textPrimary`, i.e. white on white in the dark theme (measured: the user could
 * not read their own display name). The placeholder token matches the class that exists.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={classNames(
        'flex h-10 w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = 'Input';

export { Input };
