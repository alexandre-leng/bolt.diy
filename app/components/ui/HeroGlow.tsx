import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';

/**
 * Full-height colour wash behind the landing screen (Lovable style).
 *
 * Replaces the eight animated "rays": a static gradient is cheaper, does not
 * move under the text, and fades out once a conversation starts so the chat
 * and workbench sit on a neutral surface. Purely decorative.
 */
export function HeroGlow() {
  const { started } = useStore(chatStore);

  return (
    <div
      aria-hidden="true"
      data-testid="hero-glow"
      className={classNames(
        'pointer-events-none fixed inset-0 -z-0 overflow-hidden transition-opacity duration-700',
        started ? 'opacity-0' : 'opacity-100',
      )}
    >
      {/* Lovable's full-height wash: light top, sky blue middle, pink bottom (all sizes). */}
      <div className="bolt-hero-wash absolute inset-0" />
    </div>
  );
}
