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
   * Every app/routes/api.*.ts must be declared: a file present on disk but absent from
   * routes.ts is simply not served, and the endpoint 404s in production while its code and
   * tests look fine. There is no allowlist any more — api.supabase-user.ts was declared once
   * the two live clients that fetch it were traced (SupabaseTab.tsx, connectorActivation.ts).
   */
  const apiFiles = readdirSync(routesDir).filter((name) => name.startsWith('api.') && name.endsWith('.ts'));

  it('finds the API route files', () => {
    expect(apiFiles.length).toBeGreaterThan(10);
  });

  it('serves the supabase-user route the clients fetch', () => {
    expect(declared).toContain("routes/api.supabase-user.ts', path: '/api/supabase-user'");
  });

  it.each(apiFiles.filter((name) => !name.endsWith('.spec.ts')))('declares %s in routes.ts', (file) => {
    expect(declared).toContain(`routes/${file}`);
  });
});
