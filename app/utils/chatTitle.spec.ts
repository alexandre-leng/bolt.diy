import { describe, expect, it } from 'vitest';
import { cleanChatTitle } from './chatTitle';

describe('cleanChatTitle (affichage des titres déjà enregistrés)', () => {
  it('retire « [Model: x] [Provider: y] » en tête, tel que mesuré en production', () => {
    expect(cleanChatTitle('[Model: beam-free] [Provider: OpenCodeGo] créer un site à 1 milliard')).toBe(
      'créer un site à 1 milliard',
    );
  });

  it('retire les marqueurs séparés par des lignes vides, dans les deux ordres', () => {
    expect(cleanChatTitle('[Model: gpt-4o]\n\n[Provider: OpenAI]\n\nUn jeu de cartes')).toBe('Un jeu de cartes');
    expect(cleanChatTitle('[Provider: OpenAI] [Model: gpt-4o] Un jeu')).toBe('Un jeu');
    expect(cleanChatTitle('[model: a]  Titre')).toBe('Titre');
  });

  it('laisse intact un titre normal, y compris un crochet qui ne serait pas un marqueur', () => {
    expect(cleanChatTitle('Créer un site de pagia')).toBe('Créer un site de pagia');
    expect(cleanChatTitle('[Brouillon] site vitrine')).toBe('[Brouillon] site vitrine');
    expect(cleanChatTitle('Site [Model: x] au milieu')).toBe('Site [Model: x] au milieu');
  });

  it('ne rend jamais une ligne vide', () => {
    expect(cleanChatTitle('[Model: x] [Provider: y]')).toBe('[Model: x] [Provider: y]');
    expect(cleanChatTitle(undefined)).toBe('');
    expect(cleanChatTitle(null)).toBe('');
    expect(cleanChatTitle('')).toBe('');
  });
});
