import { cubicBezier, motion } from 'framer-motion';

interface SendButtonProps {
  /** There is something to send (text or attachments). */
  show: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  onImagesSelected?: (images: File[]) => void;
}

const customEasingFn = cubicBezier(0.4, 0, 0.2, 1);

/*
 * Always rendered (bolt.new / Lovable): a round button at the right of the
 * composer toolbar. It used to appear only once text was typed, so an empty
 * composer showed no send affordance at all. Empty + idle = disabled.
 */
export const SendButton = ({ show, isStreaming, disabled, onClick }: SendButtonProps) => {
  const inactive = disabled || (!show && !isStreaming);
  return (
    <motion.button
      type="button"
      data-testid="send-button"
      aria-label={isStreaming ? 'Arrêter la génération' : 'Envoyer le message'}
      title={isStreaming ? 'Arrêter la génération' : 'Envoyer le message'}
      className="bolt-primary-button flex shrink-0 justify-center items-center w-9 h-9 rounded-full transition-[background-color,opacity,transform] hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      transition={{ ease: customEasingFn, duration: 0.17 }}
      initial={false}
      animate={{ scale: 1 }}
      disabled={inactive}
      onClick={(event) => {
        event.preventDefault();

        if (!inactive) {
          onClick?.(event);
        }
      }}
    >
      {isStreaming ? (
        <span className="i-ph:stop-fill text-base" aria-hidden="true" />
      ) : (
        <span className="i-ph:arrow-up-bold text-lg" aria-hidden="true" />
      )}
    </motion.button>
  );
};
