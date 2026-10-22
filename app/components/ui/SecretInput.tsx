import { useId, useState, type InputHTMLAttributes } from 'react';
import { classNames } from '~/utils/classNames';

type SecretInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** A masked credential field with a keyboard-accessible, non-submitting reveal control. */
export function SecretInput({ id, disabled, className, ...props }: SecretInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const revealed = visible && !disabled;
  const label = revealed ? 'Masquer le jeton' : 'Afficher le jeton';

  return (
    <div className="flex items-stretch gap-2">
      <input
        {...props}
        id={inputId}
        type={revealed ? 'text' : 'password'}
        disabled={disabled}
        className={classNames(className, 'min-w-0 flex-1')}
      />
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-controls={inputId}
        aria-pressed={revealed}
        disabled={disabled}
        onClick={() => setVisible((previous) => !previous)}
        className={classNames(
          'min-w-11 min-h-11 shrink-0 inline-flex items-center justify-center rounded-lg appearance-none bg-transparent',
          'border border-bolt-elements-borderColor text-bolt-elements-textSecondary',
          'hover:bg-bolt-elements-background-depth-2 hover:text-bolt-elements-textPrimary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
          'disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation',
        )}
      >
        <span aria-hidden="true" className={classNames(revealed ? 'i-ph:eye-slash' : 'i-ph:eye', 'w-5 h-5')} />
      </button>
    </div>
  );
}
