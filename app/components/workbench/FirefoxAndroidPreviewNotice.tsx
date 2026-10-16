import { useState } from 'react';
import { requestPrivatePreview } from '~/lib/private-preview/client';

/*
 * Firefox for Android needs require-corp, but the WebContainer preview can stay
 * blank there even when opened as a top-level page. The private preview builds the
 * project on the server and serves only its output behind the Bolt session.
 */
export function FirefoxAndroidPreviewNotice({ files = {} }: { files?: Record<string, string> }) {
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<{ status: 'idle' | 'building' | 'error'; message?: string }>({ status: 'idle' });
  const [url, setUrl] = useState<string>();

  if (dismissed) {
    return null;
  }

  const buildPrivatePreview = async () => {
    setState({ status: 'building' });

    const result = await requestPrivatePreview(files, true);

    if (result.status === 'ready') {
      setUrl(result.url);
      setState({ status: 'idle' });
      window.open(result.url, '_blank', 'noopener');
    } else {
      setState({ status: 'error', message: result.message });
    }
  };

  return (
    <div
      role="status"
      data-testid="firefox-android-preview-notice"
      className="absolute inset-x-2 top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 shadow-sm"
    >
      <span className="i-ph:warning-circle text-base shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-[12rem]">
        Firefox on Android: the WebContainer preview may remain blank. Use « Aperçu privé » to open a built copy of this
        project, or open the project in Chrome.
      </span>
      <button
        type="button"
        onClick={buildPrivatePreview}
        disabled={state.status === 'building'}
        className="rounded-full bg-amber-900 px-3 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-amber-100 dark:text-amber-950"
      >
        {state.status === 'building' ? 'Construction…' : 'Aperçu privé'}
      </button>
      {state.status === 'error' && (
        <span role="alert" className="w-full text-red-700 dark:text-red-300">
          {state.message}
        </span>
      )}
      {url && state.status === 'idle' && (
        <a href={url} target="_blank" rel="noopener" className="underline">
          Ouvrir l'aperçu
        </a>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="i-ph:x text-base opacity-70 hover:opacity-100"
      />
    </div>
  );
}
