import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Guard against a silent 404: a route file that exists under app/routes/ but is never
 * declared in app/routes.ts is simply not served. That is exactly how the screenshot
 * design endpoint returned 404 in production while its code and tests looked fine.
 */
describe('route declarations', () => {
  const routesDir = join(__dirname, 'routes');
  const declared = readFileSync(join(__dirname, 'routes.ts'), 'utf8');

  /*
   * Routes deliberately NOT declared in routes.ts. Keep this empty unless a route truly must stay
   * unserved, and say why: a route file nobody declared is a silent 404 for its callers.
   */
  const KNOWN_UNDECLARED = new Set<string>();

  const apiFiles = readdirSync(routesDir).filter((name) => name.startsWith('api.') && name.endsWith('.ts'));

  it('finds the API route files', () => {
    expect(apiFiles.length).toBeGreaterThan(10);
  });

  it.each(apiFiles.filter((name) => !name.endsWith('.spec.ts') && !KNOWN_UNDECLARED.has(name)))(
    'declares %s in routes.ts',
    (file) => {
      expect(declared).toContain(`routes/${file}`);
    },
  );

  it('keeps no stale exception in KNOWN_UNDECLARED', () => {
    /*
     * An exception that is now declared (or deleted) must be removed from the list, so the guard
     * never silently covers a real missing route.
     */
    const stale = [...KNOWN_UNDECLARED].filter(
      (name) => !apiFiles.includes(name) || declared.includes(`routes/${name}`),
    );

    expect(stale).toEqual([]);
  });
});
