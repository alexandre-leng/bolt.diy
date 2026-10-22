/*
 * Display-only clean-up of a conversation title.
 *
 * Older chats were titled from the raw first prompt, which starts with the routing header the
 * client prepends (`[Model: x]\n\n[Provider: y]\n\n…`). The fix in `fallbackDescription` only
 * applies to NEW titles; titles already stored on the server still read
 * « [Model: beam-free] [Provider: OpenCodeGo] créer un site… » in the panel and the header.
 *
 * This function strips those markers when the title is SHOWN (panel row, header, search,
 * delete confirmations). It never writes anything back: the stored description is untouched.
 */
const LEADING_MARKER = /^\s*\[(?:Model|Provider):[^\]\n]*\]\s*/i;

export function cleanChatTitle(raw: string | null | undefined): string {
  if (typeof raw !== 'string') {
    return '';
  }

  let text = raw;

  // The markers can come in either order, separated by spaces or blank lines.
  for (let guard = 0; guard < 4 && LEADING_MARKER.test(text); guard++) {
    text = text.replace(LEADING_MARKER, '');
  }

  const cleaned = text.trim();

  /*
   * A title made only of markers would render as an empty row; keep the original rather than
   * hide the conversation (the list skips rows without a description).
   */
  return cleaned || raw.trim();
}
