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
   * Known undeclared route, present before this guard existed. It is NOT served today.
   * Do not add it to routes.ts blindly: it reads cookies/tokens and has no tests. Decide
   * deliberately (declare + secure + test, or delete). Remove it from this list when done.
   */
  const KNOWN_UNDECLARED = new Set(['api.supabase-user.ts']);

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
});
