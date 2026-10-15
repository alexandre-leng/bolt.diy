import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * Compact layout only (< 1024px): Lovable's "go to preview" control. The chat
 * stays on screen during generation; this opens the workbench straight on the
 * preview. A dot signals that a preview is running.
 */
export function MobilePreviewButton() {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const previews = useStore(workbenchStore.previews);

  if (showWorkbench) {
    return null;
  }

  const ready = previews.length > 0;

  return (
    <button
      type="button"
      data-testid="mobile-preview-button"
      aria-label={ready ? 'Open preview (running)' : 'Open preview'}
      onClick={() => {
        workbenchStore.selectWorkbenchView('preview', { userInitiated: true });
        workbenchStore.showWorkbench.set(true);
      }}
      className="lg:hidden relative inline-flex items-center gap-1.5 rounded-full border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 h-9 text-sm font-medium text-bolt-elements-textPrimary shadow-xs transition-colors hover:bg-bolt-elements-background-depth-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
    >
      <span className="i-ph:play-circle text-base" aria-hidden="true" />
      Preview
      {ready && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-bolt-elements-background-depth-1"
        />
      )}
    </button>
  );
}
