import type { WebContainer } from '~/lib/runtime/container';
import {
  RUNTIME_BOOT_TOAST_ID,
  installRuntimeRejectionGuard,
  reportRuntimeBootFailure,
} from '~/lib/runtime/runtimeBootError';
import { cleanStackTrace } from '~/utils/stacktrace';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data?.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot?.data) {
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
  /*
   * Projects run in a gVisor sandbox on the Bolt host (bolt-runtime). StackBlitz WebContainer
   * has been removed: nothing is loaded from stackblitz.com / webcontainer-api.io any more.
   */
  const bootRuntime = async (): Promise<WebContainer> => {
    const { bootServerContainer } = await import('~/lib/runtime/server/boot');
    return bootServerContainer();
  };

  const bootWebContainer = (): Promise<WebContainer> =>
    Promise.resolve()
      .then(bootRuntime)
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
    (import.meta.hot?.data?.webcontainerBoot as Promise<WebContainer> | undefined) ?? bootWebContainer();

  /*
   * One boot per page lifetime: the runtime socket reconnects on its own, so a boot that failed
   * (server unreachable at first load) is surfaced to the caller rather than retried in a loop.
   */
  const getWebContainer = (): Promise<WebContainer> => Promise.resolve(bootPromise);

  /*
   * A refused boot (measured: `EBUSY`, the account already runs 3 sandboxes) used to surface
   * only as unhandled rejections in the console, one per store awaiting the boot. Tell the user
   * once, in French, and mark those derived rejections of the same failure as handled.
   */
  const notifyBootFailure = (message: string) => {
    void import('~/lib/toastify')
      .then(({ toast }) => toast.error(message, { toastId: RUNTIME_BOOT_TOAST_ID }))
      .catch(() => console.error('[runtime]', message));
  };

  if (typeof window !== 'undefined') {
    installRuntimeRejectionGuard(window, notifyBootFailure);
  }

  bootPromise.catch((error: unknown) => {
    console.warn('[runtime] project runtime did not start:', error);
    reportRuntimeBootFailure(error, notifyBootFailure);
  });

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

  if (import.meta.hot?.data) {
    // Keep the BOOT PROMISE (not the thenable) for HMR state reuse.
    import.meta.hot.data.webcontainerBoot = bootPromise.catch(() => undefined);
  }
}
