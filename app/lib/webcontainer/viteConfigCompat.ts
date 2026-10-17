/**
 * Make generated Vite configs load in browsers with tracking protection.
 *
 * Bolt's Vite starter ships `optimizeDeps: { exclude: ['lucide-react'] }`. With that line the
 * dev server does not pre-bundle lucide-react, so the preview requests every icon module one by
 * one (~1,500 files), including `lucide-react/dist/esm/icons/fingerprint.js`. Anti-tracking
 * filters (uBlock Origin, AdGuard, EasyPrivacy, Firefox strict mode) block any URL containing
 * "fingerprint"; one blocked module stops the whole app and the preview stays blank with no
 * visible error. Pre-bundling lucide-react (Vite's default) serves it as one file instead.
 *
 * Applied to what is written into the WebContainer only. Vite restarts on its own when the
 * config changes, so a running preview picks it up too.
 */
const VITE_CONFIG_PATH = /(^|\/)vite\.config\.(ts|js|mjs|cjs|mts|cts)$/;

/** `optimizeDeps: { exclude: ['lucide-react'] },` holding nothing else: drop the whole block. */
const LUCIDE_ONLY_BLOCK =
  /\n?[ \t]*optimizeDeps\s*:\s*\{\s*exclude\s*:\s*\[\s*(['"`])lucide-react\1\s*,?\s*\]\s*,?\s*\}\s*,?/g;

/** `exclude: ['lucide-react', 'other']`: drop only the lucide-react entry. */
const LUCIDE_IN_LIST = /(exclude\s*:\s*\[[^\]]*?)(['"`])lucide-react\2\s*,?\s*/g;

export function isViteConfigPath(filePath: string): boolean {
  return VITE_CONFIG_PATH.test(filePath);
}

export function stripLucideExclude(filePath: string, content: string): string {
  if (!isViteConfigPath(filePath) || !content.includes('lucide-react')) {
    return content;
  }

  return content.replace(LUCIDE_ONLY_BLOCK, '').replace(LUCIDE_IN_LIST, '$1');
}

/** Same, for write paths that may carry binary content (left untouched). */
export function compatFileContent<T>(filePath: string, content: T): T {
  return typeof content === 'string' ? (stripLucideExclude(filePath, content) as T) : content;
}
