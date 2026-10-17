import { describe, expect, it } from 'vitest';
import { compatFileContent, stripLucideExclude } from './viteConfigCompat';

/*
 * The exact config Bolt's Vite starter generates (seen in the "Pagia" project that stayed blank
 * in Firefox: `icons/fingerprint.js` blocked by the tracking filter).
 */
const STARTER = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
`;

describe('stripLucideExclude', () => {
  it('removes the starter block so lucide-react is pre-bundled (no per-icon requests)', () => {
    const out = stripLucideExclude('vite.config.ts', STARTER);

    expect(out).not.toContain('lucide-react');
    expect(out).not.toContain('optimizeDeps');
    expect(out).toContain('plugins: [react()],\n});');
  });

  it('keeps the rest of a config the agent customised', () => {
    const custom = `export default defineConfig({
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  plugins: [react()],
  server: { host: true, port: 5173, strictPort: false },
});`;

    const out = stripLucideExclude('/home/project/vite.config.ts', custom);

    expect(out).toBe(`export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, strictPort: false },
});`);
  });

  it('drops only lucide-react from a longer exclude list', () => {
    const out = stripLucideExclude('vite.config.js', `optimizeDeps: { exclude: ["lucide-react", "foo"] }`);

    expect(out).toBe(`optimizeDeps: { exclude: ["foo"] }`);
  });

  it('never touches other files, even ones mentioning lucide-react', () => {
    const app = `import { Fingerprint } from 'lucide-react';\nconst x = { exclude: ['lucide-react'] };`;

    expect(stripLucideExclude('src/App.tsx', app)).toBe(app);
    expect(stripLucideExclude('package.json', '"lucide-react": "^0.344.0"')).toBe('"lucide-react": "^0.344.0"');
  });

  it('is idempotent and leaves a config without the line unchanged', () => {
    const once = stripLucideExclude('vite.config.ts', STARTER);

    expect(stripLucideExclude('vite.config.ts', once)).toBe(once);
    expect(stripLucideExclude('vite.config.mts', 'export default {}')).toBe('export default {}');
  });

  it('leaves binary content alone', () => {
    const bytes = new Uint8Array([1, 2, 3]);

    expect(compatFileContent('vite.config.ts', bytes)).toBe(bytes);
    expect(compatFileContent('vite.config.ts', STARTER)).not.toContain('lucide-react');
  });
});
