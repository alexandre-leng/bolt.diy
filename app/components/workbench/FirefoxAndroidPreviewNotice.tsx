import { useState } from 'react';

/*
 * Firefox for Android runs WebContainer in require-corp mode (it has no COEP
 * credentialless). StackBlitz documents Firefox as alpha and recommends opening
 * the preview in a separate window; embedded previews fail to start on Android
 * Firefox upstream (stackblitz/webcontainer-core#2143). Say so instead of
 * showing a silent blank frame.
 */
export function FirefoxAndroidPreviewNotice({ onOpenInNewTab }: { onOpenInNewTab: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      data-testid="firefox-android-preview-notice"
      className="absolute inset-x-2 top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 shadow-sm"
    >
      <span className="i-ph:warning-circle text-base shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-[12rem]">
        Firefox on Android: the embedded preview often stays blank (WebContainer limitation). Open it in a new tab, or
        use Chrome.
      </span>
      <button
        type="button"
        onClick={onOpenInNewTab}
        className="rounded-full bg-amber-900 px-3 py-1 font-medium text-white hover:opacity-90 dark:bg-amber-100 dark:text-amber-950"
      >
        Open in new tab
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="i-ph:x text-base opacity-70 hover:opacity-100"
      />
    </div>
  );
}
