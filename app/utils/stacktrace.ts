/**
 * Cleans webcontainer URLs from stack traces to show relative paths instead
 */
export function cleanStackTrace(stackTrace: string): string {
  /*
   * Function to clean a single URL
   * Project previews (`p<N>.<domain>`).
   */
  const PREVIEW_URL = /^https?:\/\/p\d{1,3}\.[^/]+\/(.*?)$/;

  const cleanUrl = (url: string): string => {
    const match = url.match(PREVIEW_URL);

    return match ? match[1] || '' : url;
  };

  // Split the stack trace into lines and process each line
  return stackTrace
    .split('\n')
    .map((line) => {
      // Match any preview URL in the line
      return line.replace(/(https?:\/\/p\d{1,3}\.[^/\s]+\/[^\s)]+)/g, (match) => cleanUrl(match));
    })
    .join('\n');
}
