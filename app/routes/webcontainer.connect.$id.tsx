import type { LoaderFunctionArgs } from 'react-router';

/** The SDK opens this route as a popup to relay preview messages to the editor. */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return new Response('Invalid preview ID', { status: 400 });
  }

  /*
   * Only the StackBlitz editor is a valid SDK handshake origin. Never reflect
   * query text into an inline script: that allows script-tag injection.
   */
  const editorOrigin = 'https://stackblitz.com';
  const previewPath = `/webcontainer/preview/${id}`;

  const htmlContent = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebContainer connection · Bolt</title>
  <style>
    body { font: 16px/1.5 system-ui,sans-serif; background:#17171c; color:#f4f1fa; min-height:100vh;
      margin:0; display:grid; place-items:center; padding:24px; box-sizing:border-box; }
    main { max-width:440px; } a { color:#c4b5fd; } a:focus-visible { outline:2px solid #c4b5fd; }
  </style>
</head>
<body>
  <main>
    <h1>WebContainer connection</h1>
    <p id="connection-status">This link connects a Bolt preview to its editor. Open it from Bolt to connect.</p>
    <p><a href="${previewPath}">Open preview</a> · <a href="/">Back to Bolt</a></p>
  </main>
  <script type="module">
    if (window.opener) {
      document.getElementById('connection-status').textContent = 'Connecting the preview to Bolt…';
      import('https://cdn.jsdelivr.net/npm/@webcontainer/api@1.6.5-internal.2/dist/connect.js')
        .then(({ setupConnect }) => setupConnect({ editorOrigin: '${editorOrigin}' }))
        .catch(() => {
          document.getElementById('connection-status').textContent = 'Connection failed. Return to Bolt and reopen the preview.';
        });
    }
  </script>
</body>
</html>`;

  return new Response(htmlContent, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
