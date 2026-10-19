import type { PreviewInfo } from './previews';

/** Store order is first announcement order; updates to existing ports never move them. */
export function selectPreview(previews: readonly PreviewInfo[], manualPort: number | null): PreviewInfo | undefined {
  return previews.find((preview) => preview.port === manualPort) ?? previews.at(-1);
}
