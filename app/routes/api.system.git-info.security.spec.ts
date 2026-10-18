import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/*
 * /api/system/git-info was the only GitHub-data route with no `withSecurity` wrapper, no rate
 * limit, and it hand-rolled `Access-Control-Allow-Origin: *`. Its siblings (api.github-user,
 * api.github-branches, api.github-stats, api.gitlab-*, api.vercel-user) all wrap with
 * withSecurity({ rateLimit: true, allowedMethods: [...] }). Asserted on the source because the
 * wrapper needs a trusted-IP context to exercise end-to-end.
 */
it('wraps /api/system/git-info with the same security as its siblings', () => {
  const source = readFileSync(fileURLToPath(new URL('./api.system.git-info.ts', import.meta.url)), 'utf8');

  expect(source).toMatch(/withSecurity\(gitInfoLoader,\s*\{\s*rateLimit:\s*true,\s*allowedMethods:\s*\['GET'\]\s*\}\)/);
  expect(source).toContain("from '~/lib/security'");
});

it('does not emit a wildcard Access-Control-Allow-Origin header', () => {
  const source = readFileSync(fileURLToPath(new URL('./api.system.git-info.ts', import.meta.url)), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

  expect(code).not.toContain('Access-Control-Allow-Origin');
});
