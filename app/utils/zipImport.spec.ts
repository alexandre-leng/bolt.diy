import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createChatFromZip } from './zipImport';
import { getMessageText } from '~/lib/persistence/messageMigration';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';

async function zipFileFrom(entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();

  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }

  /*
   * zip.generateAsync produces bytes; File is the only browser type zip.loadAsync
   * accepts here, so it is constructed from a Blob. The buffer is copied into a
   * plain ArrayBuffer because the generated view is typed over ArrayBufferLike,
   * which is wider than BlobPart accepts.
   */
  const bytes = await zip.generateAsync({ type: 'uint8array' });

  return new File([new Uint8Array(bytes)], 'demo.zip', { type: 'application/zip' }) as unknown as File;
}

function importedFiles(text: string): Record<string, string> {
  const files: Record<string, string> = {};

  const parser = new StreamingMessageParser({
    callbacks: {
      onActionClose: ({ action }) => {
        if (action.type === 'file') {
          files[action.filePath] = action.content;
        }
      },
    },
  });

  parser.parse('import', text);

  return files;
}

describe('createChatFromZip', () => {
  it('preserves entities, file fences and trailing newlines through the real action parser', async () => {
    const source = '```html\n<p>&lt;literal&gt; é</p>\n```\n\n';
    const result = await createChatFromZip(await zipFileFrom({ 'README.md': source }));
    const written: string[] = [];

    const parser = new StreamingMessageParser({
      callbacks: {
        onActionClose: ({ action }) => {
          if (action.type === 'file') {
            written.push(action.content);
          }
        },
      },
    });

    parser.parse('zip-import', getMessageText(result.messages[1]));
    expect(written).toEqual([source]);
  });

  it('produces messages whose text is readable by the model pipeline', async () => {
    const result = await createChatFromZip(await zipFileFrom({ 'src/index.ts': 'export const a = 1;' }));

    const [userMessage, filesMessage] = result.messages;

    expect(userMessage.role).toBe('user');
    expect(filesMessage.role).toBe('assistant');

    /*
     * Confirm the imported text is readable through the shared accessor. The
     * separate shape test below ensures ZIP messages carry both v4 `content`
     * and v5 `parts`; a v4-only message is still readable via the accessor's
     * content fallback.
     */
    expect(getMessageText(userMessage)).toBe('Import the "demo" project from ZIP');
    expect(getMessageText(filesMessage)).toContain('<boltArtifact id="imported-files"');
    expect(
      filesMessage.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    ).toContain('<boltArtifact id="imported-files"');
    expect(importedFiles(getMessageText(filesMessage))).toEqual({ 'index.ts': 'export const a = 1;' });
  });

  it('writes both the v4 content field and the parts array', async () => {
    const result = await createChatFromZip(await zipFileFrom({ 'README.md': '# demo' }));
    const [, filesMessage] = result.messages;

    expect(typeof (filesMessage as unknown as { content: unknown }).content).toBe('string');
    expect(Array.isArray(filesMessage.parts)).toBe(true);
    expect(filesMessage.parts.length).toBeGreaterThan(0);
  });

  it('strips a common root prefix', async () => {
    const result = await createChatFromZip(
      await zipFileFrom({ 'my-project/src/index.ts': 'export const a = 1;', 'my-project/README.md': '# demo' }),
    );

    expect(getMessageText(result.messages[1])).toContain('filePath="src/index.ts"');
    expect(getMessageText(result.messages[1])).not.toContain('my-project/src/index.ts');
  });

  it('reports a Node project when package.json is present', async () => {
    const result = await createChatFromZip(
      await zipFileFrom({ 'package.json': JSON.stringify({ name: 'demo', dependencies: { react: '19.0.0' } }) }),
    );

    expect(result.hasPackageJson).toBe(true);
    expect(result.hasExpoConfig).toBe(false);
  });

  it('flags an Expo project and neutralises its scripts', async () => {
    const pkg = JSON.stringify({
      name: 'demo',
      scripts: { start: 'expo start', build: 'expo export' },
      dependencies: { expo: '52.0.0' },
    });

    const result = await createChatFromZip(await zipFileFrom({ 'package.json': pkg }));
    const text = importedFiles(getMessageText(result.messages[1]))['package.json'];

    expect(result.hasExpoConfig).toBe(true);

    /* Both runnable scripts are replaced; only the explanatory note survives. */
    expect(text).not.toContain('"start": "expo start"');
    expect(text).not.toContain('"build": "expo export"');
    expect(text).toContain('_note');
    expect(text).toContain('"expo": "52.0.0"');
  });

  it('rejects an archive with no readable text files', async () => {
    await expect(createChatFromZip(await zipFileFrom({}))).rejects.toThrow(/no files/i);
  });
});
