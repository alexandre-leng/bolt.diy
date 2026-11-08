import { describe, expect, it } from 'vitest';
import { EnhancedStreamingMessageParser } from './enhanced-message-parser';

/*
 * Le message de setup d'un projet screenshot doit s'exécuter MÊME quand la
 * conversation est re-parsée.
 *
 * Terrain (chat 2-1794125476452-0) : la carte « Project Setup » s'affiche
 * « Project Setup Incomplete / No setup actions were generated », les fichiers du
 * template s'écrivent, mais ni `npm install` ni `npm run dev` ne partent, donc
 * `npm run dev` répond `vite: not found`.
 *
 * Mécanisme : `parse()` mémorise une position par messageId et ne relit jamais un
 * message déjà consommé. Or `Chat.client.tsx` parse le même lot deux fois (au
 * chargement, puis dans l'effet qui attend la fin des actions fichier) : le second
 * passage ne rend aucune action. Le premier passage a déjà créé la carte d'artifact
 * au bon id ; la carte reste donc vide pour toujours.
 */
const SETUP = `<boltArtifact id="project-setup" title="Project Setup" type="bundled">
<boltAction type="shell">npm install --no-audit --no-fund</boltAction>
<boltAction type="start">npm run dev</boltAction>
</boltArtifact>`;

describe('setup message parsed twice', () => {
  it('replays the shell action when the same message is parsed again', () => {
    const actions: string[] = [];

    const parser = new EnhancedStreamingMessageParser({
      callbacks: {
        onActionClose: ({ action }) => actions.push(`${action.type}:${action.content}`),
      },
    });

    parser.parse('setup-msg', SETUP, true);

    const afterFirst = actions.length;

    parser.parse('setup-msg', SETUP, true);

    expect(afterFirst, 'le premier passage doit emettre les deux actions').toBe(2);

    expect(actions, 'le second passage doit rejouer les deux actions').toEqual([
      'shell:npm install --no-audit --no-fund',
      'start:npm run dev',
      'shell:npm install --no-audit --no-fund',
      'start:npm run dev',
    ]);
  });

  it('does not emit duplicate actions for a streamed partial then final', () => {
    const actions: string[] = [];

    const parser = new EnhancedStreamingMessageParser({
      callbacks: {
        onActionClose: ({ action }) => actions.push(`${action.type}:${action.content}`),
      },
    });

    const half = SETUP.slice(0, 60);

    parser.parse('stream-msg', half, false);
    parser.parse('stream-msg', SETUP, true);
    parser.parse('stream-msg', SETUP, true);

    /* Un seul jeu complet des deux actions : la relance finale ne redouble pas. */
    expect(actions.filter((a) => a.startsWith('shell:')).length).toBe(2);
  });
});
