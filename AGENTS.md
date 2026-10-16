# AGENTS.md — Règles obligatoires pour les agents IA sur bolt.diy (fork auto-hébergé)

> Ce fichier est lu par **toutes** les intelligences artificielles qui interviennent sur ce dépôt.
> Il contient des règles **non négociables**. Toute IA qui touche à ce projet doit les appliquer.
> Il complète `memory.md` : `AGENTS.md` est la **loi**, `memory.md` est l'**état réel**.

---

## 1. Règle absolue : lire `memory.md` d'abord, le compléter ensuite

Toute IA doit :

1. **LIRE `memory.md` EN PREMIER**, en entier, avant toute commande, analyse, modification ou
   réponse technique sur ce dépôt. Ce fichier se lit depuis le dépôt courant ; un résumé d'une
   conversation précédente ne le remplace pas.
2. **LIRE ce fichier (`AGENTS.md`)** juste après, pour connaître les règles en vigueur.
3. **COMPLÉTER `memory.md` avant de rendre la main**, dès qu'une tâche a produit un changement :
   décision technique, fichier structurant modifié, commande de validation, résultat de test,
   piège découvert. Une tâche **n'est pas terminée** tant que cette mise à jour n'est pas faite.
4. **NE JAMAIS SUPPRIMER, VIDER, TRONQUER NI RÉÉCRIRE `memory.md`.** Il est en **ajout seul** :
   `rm`, `git rm`, `> memory.md`, toute régénération qui écrase l'historique, un `git checkout`
   écrasant sont **interdits**. On ajoute une section datée **en haut**, on ne remplace jamais.
   Détruire ce fichier détruit la mémoire partagée de tous les agents : **échec critique de la tâche**.
5. **Apporter la preuve mécanique** après toute écriture : `git diff --numstat -- memory.md`
   doit afficher `+N  -0`. Toute suppression non nulle signale un ajout raté — le corriger avant
   de continuer. Corollaire : ne jamais « corriger » une ligne déjà écrite dans une entrée
   committée ; **ajouter** une nouvelle ligne qui porte la correction.

### Ordre de prise en charge obligatoire

(1) localiser la racine du dépôt → (2) lire `AGENTS.md` → (3) lire `memory.md` →
(4) chercher les fichiers et décisions concernés → (5) réaliser la tâche → (6) valider →
(7) mettre à jour `memory.md` → (8) commit conventionnel.

### Contrôle final obligatoire

Avant la réponse finale : `git diff -- AGENTS.md memory.md`, confirmer que la mémoire est à jour,
et mentionner explicitement ce qui a été vérifié — ainsi que ce qui **n'a pas pu** l'être.

---

## 2. Definition of done — une tâche n'est finie que si

- [ ] `npx tsc --noEmit -p .` → **0 erreur**
- [ ] `npx eslint app --quiet` → **0 erreur**
- [ ] `npx vitest --run` → **vert**, hors tests de performance sensibles à la charge
      (les relancer seuls avec `--no-file-parallelism` avant de les déclarer en échec)
- [ ] Le changement est **vérifié sur le site déployé**, pas seulement dans le build local
- [ ] `memory.md` complété, preuve `+N  -0` fournie
- [ ] Commit conventionnel, poussé

**Ne jamais annoncer qu'un correctif fonctionne depuis un test, un build local ou un code HTTP.**
La preuve est le résultat observé sur la surface concernée (le DOM mesuré, la page rendue,
l'onglet ouvert). Un `200` sur `/` ne prouve que la coquille HTML.

---

## 3. Stack verrouillée

| Composant | Version / choix | Remarque |
|---|---|---|
| Runtime | Node 22, React Router 7 | l'application est un **Cloudflare Worker**, pas une app Vite |
| Démarrage | `wrangler dev` | **pas** `dockerstart` (l'image officielle crash-loop : `vite: not found`) |
| UI | UnoCSS + tokens `bolt-elements-*` | classes **littérales** obligatoires (voir §5) |
| État | nanostores (`atom`, `map`) | dans `app/lib/stores/` |
| Fournisseur par défaut | OpenCode Go / `deepseek-v4.1-flash` | inlinés au build (`Dockerfile`, `VITE_DEFAULT_*`) |
| Tests | Vitest (projets `node` et `dom`) | un nouveau `.spec.tsx` doit être ajouté à `DOM_TESTS` dans `vitest.config.ts` |

## 4. Environnement de déploiement

| Élément | Valeur |
|---|---|
| Hôte | `169.58.18.46`, domaine `bolt.169-58-18-46.sslip.io` |
| Application | conteneur `bolt-diy` (image `bolt-diy:local`), écoute sur `127.0.0.1:5173` |
| Reverse proxy | nginx, session obligatoire (`bolt-auth`, cookie HttpOnly) |
| Historique | `bolt-history` (systemd, `127.0.0.1:8200`) |
| Publication | `bolt-publish` (systemd), sites sous `/container/<slug>/` |

**Vérifier l'IP cible avant tout déploiement** (une erreur de VPS s'est déjà produite).
**Déployer une fois, puis vérifier** : chaque déploiement renomme tous les chunks hachés, ce qui
casse les onglets ouverts. Ne pas redéployer pour corriger un symptôme qui est un onglet périmé —
le vérifier avec `awk '$9==404' /var/log/nginx/access.log`.

## 5. Conventions de code

### ❌ Interdit
- Classes UnoCSS **dynamiques** (`i-ph:${icon}`, `bg-${color}-500`) : l'extraction est statique,
  la classe n'est jamais générée. Écrire les noms **en entier**.
- `class` au lieu de `className` en JSX · `any` non justifié en TypeScript
- Données factices en production · `console.log` laissé en production
- **Secrets en dur** : clés API, mots de passe, tokens (voir §6)
- Éditer un fichier d'un autre agent sans le signaler dans `memory.md`
- Un `<div>` ou un `<span>` qui *ressemble* à un bouton : un contrôle est un `<button>`
  avec `onClick`, un nom accessible (`aria-label`) et une zone de clic ≥ 44 px sur tactile

### ✅ Obligatoire
- Classes littérales, tokens `bolt-elements-*`
- Un nom accessible sur **tout** contrôle (le libellé visible peut manquer, pas `aria-label`)
- Zones tactiles ≥ 44 px ; garder `touch-action: manipulation` sur tactile
- Vérifier un contraste **sur les pixels peints** (`getImageData`), jamais sur
  `getComputedStyle` seul, qui rapporte la valeur spécifiée et non la surface réelle
- `--force-recreate` pour recharger une image Docker déjà taguée, puis contrôler
  l'horodatage de démarrage du conteneur

## 6. Sécurité et secrets

- **Jamais** dans le dépôt : clés API, mot de passe de session, `secret.key`, hash de mot de passe.
- Les secrets vivent dans `/opt/bolt/.env.local` (mode 600) et `/opt/bolt/.bolt_password`.
- Les variables d'environnement sont transmises au Worker par `--var` dans `entrypoint.sh` :
  un Worker **ne lit pas** `process.env`. Une clé absente de `--var` est invisible de l'application
  même si `printenv` la montre dans le conteneur.
- Ne jamais afficher un secret dans une réponse ou un journal ; le lire depuis le fichier et
  le passer directement à la commande.

## 7. Git et commits

Conventional Commits, en **anglais** :

```
feat:  nouvelle fonctionnalité
fix:   correction de bug
docs:  documentation
refactor: restructuration sans changement de comportement
chore: maintenance, dépendances, configuration
```

- **Stager uniquement les fichiers du changement en cours.** L'arbre de travail contient souvent
  des modifications héritées d'autres sessions ; `git add -A` embarque le travail d'un autre agent.
  Vérifier avec `git diff --cached --stat` avant de committer.
- Le dépôt porte un hook pre-commit qui lance `typecheck` et `lint` — un commit qui passe signifie
  que les deux sont verts.
- Ne pas pousser un commit qui contient un `-N` sur `memory.md`.

## 8. Communication

- **Code, commentaires, commits, `AGENTS.md`** : anglais.
- **`memory.md` et les échanges avec l'utilisateur** : français.
- Les commentaires expliquent **pourquoi**, pas ce que la ligne fait.

## 9. Méthode d'investigation (règles apprises à la dure)

- **Mesurer avant de conclure.** Une capture d'écran interprétée par un modèle de vision est une
  hypothèse, pas une preuve : trancher par une sonde DOM (texte **et** géométrie, `elementFromPoint`
  pour la couverture, `scrollWidth` vs `clientWidth` pour le débordement).
- **Un contrôle `covered-by` son propre enfant reste cliquable** (l'événement remonte) : ne compter
  comme couverture qu'un élément **sans lien** avec le contrôle testé.
- **Ne pas confondre lenteur et panne.** Le premier chargement d'un projet prend 30-60 s
  (`npm install` puis bundling). Échantillonner la sortie du terminal dans la durée avant de
  déclarer un aperçu cassé ; `NS_BINDING_ABORTED` est souvent le script de test qui ferme le contexte.
- **Reproduire avant de corriger**, puis prouver le correctif **rouge sur l'ancien code** :
  un test qui passe avant et après n'est pas un test de non-régression.
- **Ne pas patcher un symptôme.** Si le symptôme est un chunk en 404, c'est un onglet périmé ;
  si c'est un type d'erreur masqué, lire le journal serveur avant de toucher au fournisseur.

## 10. Skills / plans du dépôt

- Les plans de travail vivent dans `.hermes/plans/` (un fichier par chantier).
- Le plan de refonte d'interface et son bilan figurent dans `/opt/bolt/plan.md`.
- Les scripts d'inspection du navigateur (Playwright) sont dans `/opt/bolt/ui-captures/` :
  réutiliser ces sondes plutôt que d'en réécrire.

---

## Sanctions en cas de non-respect

1. **Une mémoire non mise à jour casse la chaîne** : l'agent suivant repart d'un état faux.
2. **Une entrée effacée** détruit le travail de toutes les sessions précédentes.
3. **Un secret committé** est une faille de sécurité irréversible.
4. **Un correctif annoncé sans preuve** consomme la confiance et fait perdre des heures.

> **Ce fichier est la loi sur ce dépôt. Aucune exception.**
