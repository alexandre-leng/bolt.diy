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
- [x] Ajouter autorisation explicite, avertissement d’aperçu et récupération HTML.
- [x] Regrouper la progression, corriger les états obsolètes et les maquettes progressives.
- [x] Vérifier tests ciblés, typecheck, lint et build. Suite complète exécutée : deux seuils de performance restent rouges sous charge.
- [x] Vérifier navigateur à 360, 768, 1280 et 1440 px, boutons atteignables et absence de débordement.
- [ ] Après confirmation du VPS : déploiement unique, comparaison de l’ID image et marqueur du bundle servi.
- [x] Lire les fichiers réellement créés et vérifier la persistance du fichier modifié après fermeture du navigateur. Rechargement de conversation synchronisée au compte : non vérifié dans le proxy local.

## Résultats vérifiés avant déploiement

- Le cas React/Babel réel passe l’import exact après consentement ; le prédicat est stable aux répétitions. Les 10 tests d’import passent.
- Les directions progressives sont transmises explicitement du client à la route et au service privé. Les tests du contrat TypeScript passent ; le correctif Python est conservé sous `host-patches/` pour déploiement coordonné.
- Le flux réel renvoie `variantCount.value` sous forme de chaîne et des fragments tagués par variante. Les tests reproduisent puis corrigent ces deux pertes d’information.
- Typecheck et build production : code 0. Le lot ciblé incluant panneau, ChatBox, génération, import et directions : 69 tests verts avant l’ajout du dernier test de variante, puis 17 tests du module génération verts.
- Suite générale initiale : 174 fichiers verts, 2 fichiers de performance rouges (1446 tests verts, 2 rouges), plus une rejection de flux dans `api.transcribe.spec.ts`. Les mêmes specs sur le HEAD de départ passent dans une exécution séparée ; la charge influence ces mesures. La suite complète n’est donc pas déclarée verte sur cette seule base.
- Génération réelle via le backend actif : capture de test Pagia 1280×800, quatre variantes terminées en environ 50 secondes, rendues dans Chromium sans identifiants. Aucun débordement horizontal. La meilleure variante conserve les textes (à espaces normalisés), et le titre commence aux mêmes coordonnées (64, 206). Erreur absolue moyenne RGB : 3,73 sur l’échelle 0–255, valeur non nulle, donc pas de fidélité pixel parfaite ni de pourcentage marketing déduit de cette mesure.
- Le raccordement « Continuer avec Bolt » prépare un brouillon en mode Agent contenant exactement la source et le chemin, sans soumission automatique. Le test de raccordement passe.
- Vérification locale sur un conteneur de test, pas sur l’URL de production : deux sorties réelles archivées du moteur sont rejouées pour le panneau ; les écritures du runtime et les appels à l’agent sont réels, sous une identité de test sans accès au compte utilisateur. Le React/Babel fourni est relu identique octet pour octet après import. La modification du titre par DeepSeek V4.1 Flash / OpenCodeGo est relue dans le runtime, puis après fermeture du navigateur ; la différence avec le HTML d’origine est exactement le remplacement demandé, sans autre modification. Le HTML relu est rendu dans Chromium. Les API de compte/historique, non relayées dans le proxy local, ne constituent pas une preuve de synchronisation de conversation.
- La vérification réelle a révélé deux défauts supplémentaires corrigés : ne pas lancer de starter template sur un projet déjà importé ; ne pas accepter comme satisfaisant un appel natif à un outil absent de l’étape. Dans ce dernier cas, le wrapper redemande un appel correct une seule fois avant tout effet, sans contourner le plan ni rejouer une écriture déjà acceptée. Le test reproduit exactement `AI_NoSuchToolError` avant le correctif, puis passe.
- Dernière suite complète avant ces deux correctifs : 176 fichiers passent, 2 fichiers de performance échouent ; 1456 tests verts, 2 seuils de temps rouges. Aucune erreur non gérée sur cette exécution.

## Limites à communiquer

Importer un fichier HTML ne transforme pas automatiquement une page React CDN en projet Vite multi-fichiers et ne démarre pas son serveur. L’exécution de la page et la continuation avec l’agent sont des actions distinctes. L’aperçu statique du panneau ne prouve pas que les scripts de l’application fonctionnent.
