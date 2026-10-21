import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';

/** Tracks whether a modal dialog is open, so decorative layers can fade out behind it. */
function useDialogOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setOpen(document.querySelector('[role="dialog"]') !== null);
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });

    return () => observer.disconnect();
  }, []);

  return open;
}

/**
 * Full-height colour wash behind the landing screen (Lovable style).
 *
 * Replaces the eight animated "rays": a static gradient is cheaper, does not
 * move under the text, and fades out once a conversation starts so the chat
 * and workbench sit on a neutral surface. Purely decorative.
 */
export function HeroGlow() {
  const { started } = useStore(chatStore);

  /* Any Radix dialog open? The overlay is translucent, so decoration behind it must stand down. */
  const dialogOpen = useDialogOpen();

  return (
    <div
      aria-hidden="true"
      data-testid="hero-glow"
      className={classNames(
        'pointer-events-none fixed inset-0 -z-0 overflow-hidden transition-opacity duration-700',

        /*
         * A dialog owns the screen: a decorative wash keeps painting a near-white halo through the
         * overlay's translucency, which reads as a stray light control behind the modal.
         */
        started || dialogOpen ? 'opacity-0' : 'opacity-100',
      )}
    >
      {/* Lovable's full-height wash: light top, sky blue middle, pink bottom (all sizes). */}
      <div className="bolt-hero-wash absolute inset-0" />
    </div>
  );
}
