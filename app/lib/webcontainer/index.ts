import { WebContainer } from '@webcontainer/api';
import { currentCoepMode } from './coep';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

/*
 * `webcontainer` is a thenable rather than a plain promise.
 *
 * Every consumer does `await webcontainer`, including `restoreSnapshot` when a
 * chat is opened. A plain module-level promise is fatal here: one failed boot —
 * a flaky CDN fetch of the Node binary, an offline first load, a blocked
 * cross-origin request — rejects it permanently, because the binding is never
 * reassigned. Every later conversation load then throws until a full page
 * reload, while the data in IndexedDB is perfectly fine.
 *
 * Deferring to `getWebContainer()` on each `then()` means each await re-checks
 * state and re-attempts a boot that previously failed, while a boot already in
 * flight (or resolved) is still shared by every caller.
 */
let webcontainerRetriable: PromiseLike<WebContainer> | undefined;

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  /*
   * Boot with a RECOVERABLE promise.
   *
   * Every consumer does `await webcontainer`, including `restoreSnapshot` on
   * chat load. Without a catch, a single failure — a flaky CDN fetch of the
   * Node binary, an offline first load, a blocked cross-origin request —
   * rejects this module-level promise **permanently**: it is never reassigned,
   * so every later conversation load throws until a full page reload. That
   * looks exactly like "loading a conversation is broken" while the data in
   * IndexedDB is perfectly fine.
   *
   * Instead, keep the failure in a variable and re-attempt the boot on the next
   * access, with the error surfaced to the caller rather than swallowed.
   */
  const bootWebContainer = (): Promise<WebContainer> =>
    Promise.resolve()
      .then(() => {
        return WebContainer.boot({
          // Same isolation mode as the page header (nginx): require-corp on Firefox Android.
          coep: currentCoepMode(),
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });
      })
      .then(async (webcontainer) => {
        webcontainerContext.loaded = true;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        /*
         * The inspector script is optional: if it cannot be fetched, the
         * container is still usable (only visual-edit hints are lost). Failing
         * the whole boot here would take the app down for a cosmetic feature.
         */
        try {
          const response = await fetch('/inspector-script.js');

          if (response.ok) {
            const inspectorScript = await response.text();
            await webcontainer.setPreviewScript(inspectorScript);
          } else {
            console.warn(`inspector-script.js unavailable (HTTP ${response.status}); visual edit hints disabled.`);
          }
        } catch (inspectorError) {
          console.warn('inspector-script.js could not be loaded; visual edit hints disabled.', inspectorError);
        }

        // Listen for preview errors
        webcontainer.on('preview-message', (message) => {
          console.log('WebContainer preview message:', message);

          // Handle both uncaught exceptions and unhandled promise rejections
          if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
            const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
            const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';
            workbenchStore.actionAlert.set({
              type: 'preview',
              title,
              description: 'message' in message ? message.message : 'Unknown error',
              content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
              source: 'preview',
            });
          }
        });

        return webcontainer;
      });

  const bootPromise: Promise<WebContainer> =
    (import.meta.hot?.data.webcontainerBoot as Promise<WebContainer> | undefined) ?? bootWebContainer();

  /*
   * DO NOT retry a failed boot.
   *
   * WebContainer is a per-tab singleton guarded by an internal `booted` flag
   * that is set on the first `boot()` and NEVER cleared (stackblitz/webcontainer-core#1125).
   * Re-calling `boot()` after any failure therefore throws
   * "Unable to create more instances" — which masks the real, actionable error
   * (network, crossOriginIsolated, blocked CDN) behind a message that looks like
   * a resource leak. One boot per page lifetime, then surface whatever it says.
   */
  const getWebContainer = (): Promise<WebContainer> => Promise.resolve(bootPromise);

  /*
   * The exported binding stays a Promise for its consumers, but each await is
   * routed through `getWebContainer()` so HMR state and concurrent callers all
   * resolve to the one shared boot.
   */
  webcontainerRetriable = {
    then: <TResult1 = WebContainer, TResult2 = never>(
      onfulfilled?: ((value: WebContainer) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> => getWebContainer().then(onfulfilled, onrejected),
  };

  webcontainer = webcontainerRetriable as Promise<WebContainer>;

  if (import.meta.hot) {
    // Keep the BOOT PROMISE (not the thenable) for HMR state reuse.
    import.meta.hot.data.webcontainerBoot = bootPromise.catch(() => undefined);
  }
}
