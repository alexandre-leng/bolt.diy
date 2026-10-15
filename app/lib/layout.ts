/**
 * Compact layout = phones and small tablets (< 1024px), the same threshold the
 * workbench already uses (`useViewport(1024)`) to go full width.
 *
 * In this layout Bolt behaves like Lovable on mobile: the chat stays on screen
 * and the workbench (preview/code) opens only when the user asks for it.
 */
export const COMPACT_LAYOUT_MAX_WIDTH = 1024;

export function isCompactLayout(width: number | undefined = globalThis.window?.innerWidth): boolean {
  return typeof width === 'number' && width < COMPACT_LAYOUT_MAX_WIDTH;
}
