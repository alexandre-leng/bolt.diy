export type PrivatePreviewResult = { status: 'ready'; url: string } | { status: 'error'; message: string };

/**
 * Asks the server to build the project privately. The result never contains a
 * link unless the build succeeded: a failed build must not look like a preview.
 */
export async function requestPrivatePreview(
  files: Record<string, string>,
  build: boolean,
): Promise<PrivatePreviewResult> {
  try {
    const response = await fetch('/api/private-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, build }),
    });

    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };

    if (!response.ok || !body.ok || !body.url) {
      return { status: 'error', message: body.error || `Échec (HTTP ${response.status})` };
    }

    return { status: 'ready', url: body.url };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Erreur réseau' };
  }
}
