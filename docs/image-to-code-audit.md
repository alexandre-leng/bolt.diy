# Audit image vers code et intégration Bolt

## Périmètre

Parcours : description vers maquettes ou image importée, génération de variantes, examen de la source, import explicite dans le projet. Conserver les changements non commités existants via un snapshot dans un worktree séparé. Ne pas modifier la production avant confirmation du VPS 169.58.18.46.

## Défauts constatés

- P0 : le générateur accepte une application React CDN/Babel complète, mais l’importeur rejette son script inline. Reproduit avec le HTML NOVA fourni par Alex, conservé dans `app/lib/screenshot/fixtures/react-babel.html`. Retirer le script laisse le conteneur React vide.
- P0 : le prédicat de script utilise une expression régulière globale avec `.test()`. Son curseur persistant permet à une tentative répétée identique de contourner le refus. Reproduit par trois tentatives consécutives.
- P1 : le nom de fichier unique bloque tout deuxième import. Allouer un nouveau nom dans la file de mutations, sans écraser fichier ni dossier.
- P1 : les jetons de flux sont affichés comme autant de lignes. Le journal borné perd le contexte de phrases entières.
- P1 : aperçu sans script incompatible avec un corps entièrement construit par React. Ne pas présenter une frame vide comme aperçu fonctionnel : afficher clairement la limite et permettre la récupération de la source.
- P1 : la réception progressive d’une nouvelle direction de maquette peut effacer les précédentes.
- P2 : statuts anglais dans une interface française, cycle de montage StrictMode et changement de stack à couvrir par des régressions.

## Direction UX

Préserver palette, typographie et surfaces Bolt existantes. Deux points d’entrée visibles et un seul pipeline. Hiérarchie : source, configuration, progression, résultats, import. Contraste via les tokens de surface existants, focus visible et fonctionnement clavier. Les changements de stack, maquette ou variante invalident les résultats ou le consentement correspondant.

## Contrat de sécurité

L’import interactif requiert une autorisation explicite dans le panneau. Cette autorisation permet de conserver la source telle quelle dans un fichier du projet, pas de l’exécuter dans l’origine Bolt. Aucun processus, artifact ou shell n’est lancé par l’import. L’aperçu du panneau conserve son sandbox sans scripts et sa CSP restrictive. Le mode statique existant reste disponible pour les appels sans consentement. Les fichiers existants ne sont jamais écrasés.

## Todo et critères d’acceptation

- [x] Reproduire le refus du cas React/Babel réel avec un test rouge.
- [x] Reproduire le contournement du prédicat à la répétition.
- [x] Conserver exactement le HTML interactif après consentement, sans exécution automatique.
- [x] Choisir un nom libre pour un nouvel import.
- [ ] Ajouter autorisation explicite, avertissement d’aperçu et récupération HTML.
- [ ] Regrouper la progression, corriger les états obsolètes et les maquettes progressives.
- [ ] Vérifier tests ciblés, suite complète, typecheck, lint et build.
- [ ] Vérifier navigateur à 360, 768 et 1440 px, clavier et absence de débordement.
- [ ] Après confirmation du VPS : déploiement unique, comparaison de l’ID image et marqueur du bundle servi.
- [ ] Lire le fichier réellement créé dans un projet et vérifier sa persistance.

## Résultats vérifiés avant déploiement

- Le cas React/Babel réel passe l’import exact après consentement ; le prédicat est stable aux répétitions. Les 10 tests d’import passent.
- Les directions progressives sont transmises explicitement du client à la route et au service privé. Les tests du contrat TypeScript passent ; le correctif Python est conservé sous `host-patches/` pour déploiement coordonné.
- Le flux réel renvoie `variantCount.value` sous forme de chaîne et des fragments tagués par variante. Les tests reproduisent puis corrigent ces deux pertes d’information.
- Typecheck et build production : code 0. Le lot ciblé incluant panneau, ChatBox, génération, import et directions : 69 tests verts avant l’ajout du dernier test de variante, puis 17 tests du module génération verts.
- Suite générale initiale : 174 fichiers verts, 2 fichiers de performance rouges (1446 tests verts, 2 rouges), plus une rejection de flux dans `api.transcribe.spec.ts`. Les mêmes specs sur le HEAD de départ passent dans une exécution séparée ; la charge influence ces mesures. La suite complète n’est donc pas déclarée verte sur cette seule base.
- Génération réelle via le backend actif : capture de test Pagia 1280×800, quatre variantes terminées en environ 50 secondes, rendues dans Chromium sans identifiants. Aucun débordement horizontal. La meilleure variante conserve les textes (à espaces normalisés), et le titre commence aux mêmes coordonnées (64, 206). Erreur absolue moyenne RGB : 3,73 sur l’échelle 0–255, valeur non nulle, donc pas de fidélité pixel parfaite ni de pourcentage marketing déduit de cette mesure.
- Le raccordement « Continuer avec Bolt » prépare un brouillon en mode Agent contenant exactement la source et le chemin, sans soumission automatique. Le test de raccordement passe. L’édition réelle par le modèle et la persistance restent des vérifications distinctes.

## Limites à communiquer

Importer un fichier HTML ne transforme pas automatiquement une page React CDN en projet Vite multi-fichiers et ne démarre pas son serveur. L’exécution de la page et la continuation avec l’agent sont des actions distinctes. L’aperçu statique du panneau ne prouve pas que les scripts de l’application fonctionnent.
