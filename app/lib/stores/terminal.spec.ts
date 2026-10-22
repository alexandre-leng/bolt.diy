import { beforeEach, describe, expect, it } from 'vitest';
import { TerminalStore } from './terminal';

/*
 * Alex : le terminal doit s'ouvrir REPLIE dans l'editeur, pas a 25 % de la hauteur.
 * `showTerminal` pilote a la fois la taille par defaut du panneau (TerminalTabs) et
 * celle du panneau editeur (Workbench.client) : un seul defaut a tenir.
 */
describe('terminal store: etat initial', () => {
  let store: TerminalStore;

  beforeEach(() => {
    // Une promesse non resolue suffit : l'etat initial ne touche pas au webcontainer.
    store = new TerminalStore(new Promise(() => {}));
  });

  it('demarre replie', () => {
    expect(store.showTerminal.get()).toBe(false);
  });

  it('se deplie puis se replie de nouveau', () => {
    store.toggleTerminal(true);
    expect(store.showTerminal.get()).toBe(true);

    store.toggleTerminal();
    expect(store.showTerminal.get()).toBe(false);
  });
});
