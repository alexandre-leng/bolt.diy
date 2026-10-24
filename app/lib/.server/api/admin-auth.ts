/** Server-side admin check. The reverse proxy injects this after validating the session. */
export function requireAdmin(request: Request): Response | undefined {
  if (request.headers.get('X-Bolt-User-Admin')?.toLowerCase() === 'true') {
    return undefined;
  }

  return Response.json({ error: 'Accès administrateur requis' }, { status: 403 });
}
