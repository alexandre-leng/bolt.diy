import { useCallback, useState } from 'react';
import { toast as baseToast } from 'react-toastify';
import type { ToastContent, ToastOptions } from 'react-toastify';
import { classNames } from '~/utils/classNames';

/*
 * Central policy for ERROR toasts.
 *
 * The default react-toastify behaviour is actively hostile to the one thing
 * people need to do with an error: READ IT AND SEND IT TO SOMEONE.
 *   - `autoClose: 3000`  → gone after three seconds, usually mid-sentence
 *   - `closeOnClick: true` → the first click meant to start a text selection
 *                            closes it instead
 *   - `draggable: true`    → dragging fights the same gesture
 *
 * So errors persist until dismissed, never close on click, are selectable, and
 * carry an explicit copy button. Non-error toasts keep the stock behaviour.
 */
export const ERROR_TOAST_OPTIONS: ToastOptions = {
  autoClose: false,
  closeOnClick: false,
  draggable: false,
  pauseOnHover: true,

  /*
   * react-toastify 11 reads the per-toast class from `className`. The former
   * `toastClassName` key is not a ToastOptions field (tsc TS2353): it was
   * silently ignored, so `.bolt-error-toast` never reached the DOM.
   */
  className: 'bolt-error-toast select-text',
};

/** Text handed to the copy button: everything the user would want to paste. */
function buildCopyText(content: ToastContent): string {
  if (typeof content === 'string') {
    return content;
  }

  if (content == null) {
    return '';
  }

  /*
   * React nodes and elements cannot be stringified meaningfully; the toast body
   * remains selectable for those, and the string case covers every error here.
   */
  return '';
}

function ErrorCloseButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /*
       * Clipboard API can be unavailable (permissions/insecure context):
       * fall back to a selectable textarea so the gesture still succeeds.
       */
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();

      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div className="flex items-center gap-1 pr-1">
      <button
        type="button"
        onClick={(event) => {
          // Stop the toast container from treating this as a dismiss click.
          event.stopPropagation();
          void copy();
        }}
        title="Copy error"
        aria-label="Copy error message"
        className={classNames(
          'rounded p-1 transition-colors',
          'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-background-depth-3',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
        )}
      >
        <div className={copied ? 'i-ph:check-bold text-lg' : 'i-ph:copy text-lg'} aria-hidden="true" />
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}

type ErrorToast = (
  content: ToastContent,
  options?: Omit<ToastOptions, 'closeButton'>,
) => ReturnType<typeof baseToast.error>;

/**
 * Drop-in replacement for `toast.error` from react-toastify.
 *
 * Call sites keep the exact same signature; they gain the error policy above
 * plus a copy button without touching 175 individual calls.
 */
const error: ErrorToast = (content, options = {}) => {
  const text = buildCopyText(content);

  return baseToast.error(content, {
    ...ERROR_TOAST_OPTIONS,
    ...options,

    // Keep the error classes when a caller passes its own string className.
    className:
      typeof options.className === 'string'
        ? classNames(ERROR_TOAST_OPTIONS.className as string, options.className)
        : (options.className ?? ERROR_TOAST_OPTIONS.className),

    // Per-toast copy control; the container-level close button stays for the rest.
    closeButton: <ErrorCloseButton text={text} />,
  });
};

/**
 * react-toastify's `toast` with only `.error` replaced.
 *
 * Every app file imports `toast` from here instead of 'react-toastify', so the
 * policy lives in ONE place and the other four severities behave exactly as
 * before.
 */
export const toast: typeof baseToast = Object.assign(
  ((content: ToastContent, options?: ToastOptions) => baseToast(content, options)) as typeof baseToast,
  baseToast,
  { error },
);
