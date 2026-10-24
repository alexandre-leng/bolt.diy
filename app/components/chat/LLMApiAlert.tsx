import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LlmErrorAlertType } from '~/types/actions';
import { classNames } from '~/utils/classNames';

interface Props {
  alert: LlmErrorAlertType;
  clearAlert: () => void;

  /** Resumes the conversation after a dropped connection. */
  onContinue?: () => void;
}

export default function LlmErrorAlert({ alert, clearAlert, onContinue }: Props) {
  const { title, description, provider, errorType } = alert;
  const [copied, setCopied] = useState(false);

  const getErrorIcon = () => {
    switch (errorType) {
      case 'authentication':
        return 'i-ph:key-duotone';
      case 'rate_limit':
        return 'i-ph:clock-duotone';
      case 'quota':
        return 'i-ph:warning-circle-duotone';
      default:
        return 'i-ph:warning-duotone';
    }
  };

  const getErrorMessage = () => {
    switch (errorType) {
      case 'authentication':
        return `Authentication failed with ${provider}. Please check your API key.`;
      case 'rate_limit':
        return `Rate limit exceeded for ${provider}. Please wait before retrying.`;
      case 'quota':
        return `Quota exceeded for ${provider}. Please check your account limits.`;
      case 'network':
        return title === 'Connection lost'
          ? 'The reply stopped before it was complete.'
          : 'An error occurred while processing your request.';
      default:
        return 'An error occurred while processing your request.';
    }
  };

  /*
   * Errors here only ever close via the Dismiss button, nothing times out,
   * and this button exists because the message is worth keeping: users paste it
   * into a bug report. Everything needed to reproduce goes on the clipboard.
   */
  const copyError = useCallback(async () => {
    const text = [title, getErrorMessage(), description ? `Error Details: ${description}` : '']
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
  }, [title, description]);

  /*
   * Bound natively rather than through React's `onClick`.
   *
   * This alert renders inside framer-motion's `AnimatePresence`, and on the
   * deployed build React's synthetic handler for this button never fired even
   * though the DOM event demonstrably reached it (verified with a capture-phase
   * listener on the button, on the root, and on `document`). The sibling
   * Dismiss button (same parent, same event) works. A native listener on the
   * element itself removes the dependency on that delegation entirely.
   */
  const copyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = copyButtonRef.current;

    if (!element) {
      return undefined;
    }

    const onClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyError();
    };

    element.addEventListener('click', onClick);

    return () => element.removeEventListener('click', onClick);
  }, [copyError]);

  // Native listener for the same reason as the Copy button above.
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = continueButtonRef.current;

    if (!element || !onContinue) {
      return undefined;
    }

    const onClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      onContinue();
    };

    element.addEventListener('click', onClick);

    return () => element.removeEventListener('click', onClick);
  }, [onContinue]);

  const canContinue = Boolean(onContinue) && errorType === 'network' && title === 'Connection lost';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 mb-2"
      >
        <div className="flex items-start">
          <motion.div
            className="flex-shrink-0"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className={`${getErrorIcon()} text-xl text-bolt-elements-button-danger-text`}></div>
          </motion.div>

          <div className="ml-3 flex-1">
            <motion.h3
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-sm font-medium text-bolt-elements-textPrimary"
            >
              {title}
            </motion.h3>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-2 text-sm text-bolt-elements-textSecondary"
            >
              <p>{getErrorMessage()}</p>

              {description && (
                <div className="llm-error-details text-xs text-bolt-elements-textSecondary p-2 bg-bolt-elements-background-depth-3 rounded mt-4 mb-4">
                  Error Details: {description}
                </div>
              )}
            </motion.div>

            <motion.div
              className="mt-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="flex gap-2">
                {canContinue && (
                  <button
                    ref={continueButtonRef}
                    type="button"
                    data-testid="llm-error-continue"
                    className={classNames(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium',
                      'bolt-primary-button hover:opacity-90',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500',
                    )}
                  >
                    <div className="i-ph:arrow-clockwise" aria-hidden="true" />
                    Continue
                  </button>
                )}
                <button
                  onClick={clearAlert}
                  className={classNames(
                    'px-2 py-1.5 rounded-md text-sm font-medium',
                    'bg-bolt-elements-button-secondary-background',
                    'hover:bg-bolt-elements-button-secondary-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-secondary-background',
                    'text-bolt-elements-button-secondary-text',
                  )}
                >
                  Dismiss
                </button>
                <button
                  ref={copyButtonRef}
                  type="button"
                  title="Copier le détail de l’erreur"
                  aria-label="Copier le détail de l’erreur"
                  className={classNames(
                    'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium',
                    'bg-bolt-elements-button-secondary-background',
                    'hover:bg-bolt-elements-button-secondary-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-secondary-background',
                    'text-bolt-elements-button-secondary-text',
                  )}
                >
                  <div className={copied ? 'i-ph:check-bold' : 'i-ph:copy'} aria-hidden="true" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
