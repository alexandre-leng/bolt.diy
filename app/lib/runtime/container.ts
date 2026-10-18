/**
 * Types of the project runtime. Projects run in Bolt's own sandboxes (bolt-runtime, gVisor
 * containers on the Bolt host); StackBlitz WebContainer has been removed. The names are kept so
 * the rest of the app reads the same.
 */
export type { ServerContainer as WebContainer, ServerProcess as WebContainerProcess } from './server/serverContainer';
export type { ServerWatchEvent as PathWatcherEvent } from './server/serverContainer';
