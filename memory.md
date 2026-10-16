# Mémoire Externe Partagée — bolt.diy (fork auto-hébergé)

> **Cette mémoire est la seule continuité entre les sessions et les agents IA.**
> Elle n'a aucune valeur si elle n'est pas lue avant d'agir et complétée après avoir agi.

## Règles de ce fichier (à respecter par tout agent, y compris humain)

1. **LIRE ce fichier en premier**, entièrement, avant toute commande, analyse, modification
   ou réponse technique sur ce dépôt. Depuis le dépôt courant : un résumé d'une conversation
   précédente ne le remplace pas.
2. **COMPLÉTER ce fichier avant de terminer toute tâche** qui a produit un changement :
   décision, fichier structurant, commande de validation, résultat de test, piège découvert.
   Une tâche n'est pas terminée tant que ce n'est pas fait.
3. **AJOUT SEUL.** Il est interdit de supprimer, vider, tronquer ou réécrire ce fichier
   (`rm`, `git rm`, `> memory.md`, régénération par script, `git checkout` écrasant). On
   ajoute une section datée **en haut** (ordre chronologique inverse), on ne remplace jamais.
   **Preuve obligatoire après écriture : `git diff --numstat -- memory.md` doit afficher
   `+N  -0`.** Un `-N` non nul est un ajout raté : le corriger avant de rendre la main.
4. **JAMAIS de secret ici** : aucune clé API, mot de passe, token, cookie, donnée personnelle.
   Les secrets vivent dans `/opt/bolt/.env.local` (mode 600) et `/opt/bolt/.bolt_password`.
5. **Contradiction code ↔ mémoire** : le code réellement déployé gagne. Vérifier, puis corriger
   cette mémoire dans la même tâche — sans jamais réécrire une entrée existante (voir règle 3).

## Format d'une entrée

```markdown
## YYYY-MM-DD — Titre court

- **Type** : feat | fix | docs | refactor | deploy | decision | bug | cost | question | trick
- **Contexte** : pourquoi cette action, quel problème était en jeu
- **Action** : ce qui a été fait concrètement (fichiers, commandes, décisions)
- **Preuve** : mesure réelle, résultat de test, sortie de commande (chiffres, pas d'adjectifs)
- **Conséquence** : impact (build, deploy, UX, perf, coût)
- **Commit** : hash court du commit qui porte le changement
- **Reste ouvert** : ce qui n'est pas fait ou pas vérifié
```

---

## 2026-10-16 — Une conversation existait mais son URL répondait 404 (`GET /api/history/<urlId>`)

- **Type** : fix
- **Contexte** : « le preview ne fonctionne pas » sur `/chat/2-1792165586520-0`. Le preview était
  hors de cause (WebContainer en 200, `crossOriginIsolated` = true, zéro erreur JS). Le vrai
  symptôme était qu'une conversation rechargée depuis son adresse semblait vide, parce que le
  serveur répondait 404 alors que la conversation existait.
- **Cause** : un chat porte **deux** identifiants. `id` est la clé courte du serveur (`4`) ;
  `urlId` est ce que le client met dans l'URL (`2-1792165586520-0`). Les deux sont stockés en
  base, mais `GET /api/history/<x>` ne cherchait que `WHERE id = x`. Le navigateur envoyant
  l'`urlId`, chaque rechargement de conversation tombait sur `chat not found`. Le `DELETE`
  avait déjà été corrigé en `id OR url_id` lors d'une tâche précédente : **seul le GET avait
  été oublié**, ce qui rend le défaut asymétrique et discret (l'écriture marche, la relecture non).
- **Action** : dans `/opt/bolt/history/bolt_history.py`, la lecture passe à
  `WHERE (id = :'chat_id' OR url_id = :'chat_id')`, toujours bornée par `user_id`. Ajout d'un
  commentaire expliquant pourquoi deux identifiants coexistent, pour qu'un futur agent ne
  « simplifie » pas la requête en la ramenant à `id`.
- **Preuve** : avant, `7` conversations répondaient `200` par `id` et `404` par `urlId`. Après
  redémarrage, les `7` répondent `200` par les deux, et l'ouverture réelle de
  `/chat/2-1792166952546-0` affiche le contenu de la conversation (`700` caractères de texte
  visible, messages présents).
- **Piège découvert** : nginx refusait d'écrire ses tampons de requête —
  `[crit] open() "/var/lib/nginx/body/0000000808" failed (13: Permission denied)`. Les workers
  tournent sous deux uid (root et www-data) alors que la conf déclare `user www-data`. Corrigé
  par `chown -R www-data:www-data /var/lib/nginx/body` (dossier en `700`). Un `PUT /api/history`
  qui échoue ainsi **perd silencieusement une sauvegarde de conversation** : le symptôme visible
  n'est pas une erreur mais des messages qui disparaissent. Vérifié avec un corps de `366 Ko` :
  plus aucune ligne `Permission denied`.
- **Reste ouvert** : `Cross-Origin-Opener-Policy` absent de la conf nginx (COEP est bien envoyé
  sur les 200, mais `add_header` ne s'applique pas aux `return 302`, donc `/login` part sans
  en-têtes cross-origin).
- **Commit** : (à compléter)

## 2026-10-16 — Suppression d'une conversation : trois défauts, dont un no-op silencieux

- **Type** : fix
- **Contexte** : « BOLT bug suppression des conversations ». Le symptôme réel n'était pas « la
  suppression ne fait rien » mais « la conversation revient ». IndexedDB n'est qu'un cache ;
  `bolt-history` (PostgreSQL) est la source de vérité, donc une suppression qui n'atteint pas le
  serveur est annulée par la synchro suivante.
- **Action** : trois correctifs indépendants, chacun suffisant à ressusciter un chat :
  1. `Menu.client.tsx` `deleteChat` n'appelait que `deleteById(db, id)`. `deleteHistory` existait
     dans `syncClient.ts` et n'était importé que par son propre spec. La purge serveur est
     maintenant faite **avant** l'effacement local, suivie de `invalidateChatCache`.
  2. `bolt_history.py` `do_DELETE` ne filtrait que sur `id`, jamais `url_id`. La clé locale et
     l'`urlId` serveur diffèrent souvent (`id: "1"` vs `urlId: "2-1792162703891-0"`) : le DELETE
     répondait **`200 {"ok":true,"removed":0}`**, un no-op silencieux déguisé en succès. Le
     `WHERE` matche désormais `(id = :'chat_id' OR url_id = :'chat_id') AND user_id = :'owner'`.
  3. Course entre le DELETE et la synchro qu'il déclenche (`deleteItem` → `deleteChat` puis
     `loadEntries()`, qui migre avec une liste capturée avant l'effacement). Registre
     `deletedIds` (`markDeleted`/`isDeleted`) dans `historySync.ts`, consulté par les **deux**
     boucles de `migrateLocalHistoryToServer` (push et pull).
- **Preuve** : suppression par `urlId` sur le service réel : `removed: 0` → **`removed: 1`** ;
  chat absent de `GET /history`, absent après reload, `GET` direct → 404, id invalide → 400.
  Isolation multi-comptes : un autre compte obtient `removed: 0` et le chat reste intact.
  Tests : 862/862 verts en série. Régressions prouvées rouges (registre neutralisé → les 3
  nouveaux tests échouent, les 3 autres restent verts ; ancien `importExportService` →
  `expected [] to include '/api/history/chat-1'`). `tsc` 0, eslint 0. Correctif confirmé
  présent dans le chunk servi.
- **Conséquence** : supprimer une conversation la supprime réellement, sur tous les appareils,
  et elle ne réapparaît plus après un rechargement.
- **Commit** : ce commit
- **Reste ouvert** : un onglet resté ouvert avant le déploiement peut encore repousser d'anciens
  chats depuis son cache jusqu'à un rechargement ; un `GET /history` sans header
  `X-Bolt-User-Id` répond `500` au lieu de `400/401` (défaut préexistant du multi-comptes).
- **Piège** : l'`urlId` et l'`id` diffèrent, et `removed: 0` accompagné d'un HTTP 200 est le
  signe exact du no-op. Ne jamais conclure « supprimé » sur `ok: true` seul.

## 2026-10-16 — `workbench.spec.ts` : 10 tests étaient masqués par un timeout WebContainer

- **Type** : fix
- **Contexte** : la suite complète échouait sur deux tests, **sur HEAD pur** (vérifié en
  extrayant `git archive HEAD` dans un conteneur séparé) — donc préexistants, pas des
  régressions. `workbench.spec.ts` expirait à 5000 ms et `tests/setup-dom.spec.ts` exigeait que
  ce même fichier soit exclu des deux projets.
- **Action** : cause racine — `filesStore.reset()` faisait `await this.#webcontainer`, une
  promesse module-level qui ne se résout qu'après un boot réussi. En test comme dans un
  navigateur où le runtime est indisponible, elle ne se résout **jamais**, donc `resetWorkbench()`
  bloquait indéfiniment alors que la carte de fichiers en mémoire était déjà correcte. L'attente
  est désormais bornée (`Promise.race` à 500 ms) et le vidage du répertoire reste best-effort.
  L'assertion obsolète de `setup-dom.spec.ts` est remplacée par une garde qui **vérifie que le
  spec tourne** au lieu de disparaître silencieusement.
- **Preuve** : `workbench.spec.ts` 10/10 verts, le test qui expirait passe en 505 ms ;
  `setup-dom.spec.ts` 8/8. Suite complète verte. Le timeout existait sur HEAD pur, avant tout
  changement de cette session.
- **Conséquence** : 10 tests de plus réellement exécutés ; le piège d'une exclusion qui masque
  de la couverture est maintenant surveillé par un test.
- **Commit** : ce commit
- **Reste ouvert** : `Markdown.spec.ts` reste exclu des deux projets (`import.meta.hot`) — sa
  couverture n'est pas restaurée.
- **Piège** : ne jamais « corriger » un test qui échoue en l'excluant. Ici l'exclusion proposée
  aurait supprimé 10 tests réels ; la cause était un `await` non borné sur le WebContainer.

## 2026-10-16 — En-tête du panneau latéral : deux rectangles clairs supprimés

- **Type** : fix
- **Contexte** : Alex a fourni le HTML de la barre du panneau latéral (nom + avatar). La mesure a
  montré que **deux** contrôles peignaient `rgb(239,239,239)` (surface par défaut du navigateur)
  sur la barre `rgb(52,55,70)`, **dans les deux thèmes** : le bouton de fermeture et le
  déclencheur du menu de compte. Les deux se voyaient comme deux rectangles clairs.
- **Action** : les deux contrôles passent sur `.header-icon-control` (même géométrie 36×36
  arrondie que la barre de l'application). `SettingsButton`/`HelpButton` portaient un
  `text-[#666]` codé en dur qui ignore le thème (~2,5:1 sur ce fond) : remplacé par l'encre
  secondaire du thème. `AccountMenu` reçoit une surface transparente explicite. Le bouton de
  mode sélection et « Start new chat » abandonnent `purple-*`/`gray-*` pour les tokens accent et
  `bolt-elements-*`. `IconButton` reçoit `type="button"` (il n'en avait pas).
- **Preuve** : après déploiement, deux thèmes — fonds opaques `0` (avant 2), tailles
  `['36x36','122x40']` (avant 30×30 / 28×28 / 122×40), rayons `['9999px']` (avant 6px), contrôles
  sans nom accessible `0`, occurrences de `#666` `0` (avant 2). tsc 0, tests des composants
  concernés verts.
- **Conséquence** : les deux barres (application et panneau) partagent enfin la même géométrie de
  contrôle, et plus aucun n'imprime de rectangle clair sur fond sombre.
- **Commit** : `749e843`
- **Reste ouvert** : les couleurs codées en dur restantes dans le corps du panneau (pastilles de
  conversation, filtres) n'ont pas été revues — hors du périmètre demandé.
- **Piège** : `Menu.client.tsx` contenait du travail **non committé d'un autre agent** (suppression
  serveur d'abord). Le staging partiel (`git apply --cached` sur les seuls hunks de l'en-tête) a
  permis de ne pas l'embarquer : le diff stagé est passé de 98 à 28 lignes.

## 2026-10-16 — En-tête : une seule géométrie de contrôle, plus de rectangle clair parasite

- **Type** : fix
- **Contexte** : demande utilisateur « améliore ces boutons dans bolt ça va niveau design », avec
  une capture de la barre du haut. La capture suggérait un bouton plein gris et un carré vide :
  la vision s'est trompée (mesure DOM : tous les contrôles en `rgba(0,0,0,0)`), mais la mesure a
  révélé deux vrais défauts et une incohérence générale.
- **Action** : le bouton de renommage (`ChatDescription.client.tsx`) était un `<button>` nu
  (`className="ml-2 i-ph:pencil-fill"`) — sans `type`, sans `aria-label`, et donc avec le fond
  gris clair par défaut du navigateur (`rgb(248,248,242)` mesuré) qui peignait un rectangle clair
  dans l'en-tête sombre. Le logo (`<a href="/">`) ne portait **aucun** nom accessible (`hasLabel`
  faux, texte vide) alors que c'est le seul retour vers l'accueil. Nouvelle classe partagée
  `.header-icon-control` dans `index.scss` (cible 36×36, rayon plein, surface explicitement
  transparente, un seul palier de survol, anneau de focus, `touch-action`), utilisée par le
  retour, le toggle de barre latérale, « nouveau projet » et le crayon.
- **Preuve** : après déploiement, dans les deux thèmes — tailles des contrôles-icône `['36x36']`,
  rayons `['9999px']`, fonds opaques `0`, contrôles sans nom accessible `0`, aucun débordement.
  Avant : tailles 32/36/icône nue, rayons 9999px/6px/0px, un fond opaque, deux sans nom.
  134/134 tests sur `app/components/header/`, `layout-stability` et `app/lib/persistence/` ;
  tsc 0 ; lint propre sur les fichiers touchés.
- **Conséquence** : la barre a une unité visuelle, le crayon ne peint plus de rectangle clair,
  et le logo est annoncé « bolt.diy home » par un lecteur d'écran.
- **Commit** : `ef5ca39`
- **Reste ouvert** : les grands écarts au centre (623 px / 539 px) varient avec la longueur du
  titre, qui occupe l'espace flexible — comportement voulu, pas un défaut. Les erreurs de lint
  restantes (`ChatBox.tsx`, `ScreenshotToCode.tsx`) appartiennent à un autre agent.
- **Piège** : `docker compose up --force-recreate` a échoué sur un conflit de nom de conteneur ;
  `docker rm -f bolt-diy` puis `docker compose up -d` a fonctionné.

## 2026-10-16 — Création de la mémoire partagée et des règles agents (memory.md + AGENTS.md)

- **Type** : docs
- **Contexte** : ce fork de bolt.diy est modifié par plusieurs sessions et agents qui n'ont
  aucune mémoire les uns des autres. Sans mémoire externe, chaque session redécouvre les mêmes
  pièges (provider OpenCode Go, COEP Firefox, chunks périmés après déploiement) et peut défaire
  silencieusement le travail précédent.
- **Action** : création de `memory.md` (ce fichier) et `AGENTS.md` à la racine, sur le modèle
  employé pour Freshrecap (`.agents/memory.md` + `AGENTS.md`), adaptés à la réalité de ce fork.
  Mémoire préremplie avec l'historique réel de la session.
- **Preuve** : recherche exhaustive avant création — `find` sur `AGENTS.md`/`memory.md` et
  `ls` de la racine : aucun des deux n'existait dans ce dépôt (seul `.hermes/plans/` existait).
- **Conséquence** : tout agent doit désormais lire ces deux fichiers avant d'agir et compléter
  `memory.md` avant de rendre la main.
- **Commit** : voir le commit qui ajoute ces deux fichiers
- **Reste ouvert** : aucune automatisation (hook pre-commit) ne vérifie encore la mise à jour
  de la mémoire ; le contrôle est laissé à la règle et à la revue.

## 2026-10-16 — Le preview « ne marche pas » : installation lente, pas panne

- **Type** : trick
- **Contexte** : signalement utilisateur « le preview ça marche pas » sur une conversation
  existante (Firefox desktop). Plusieurs hypothèses ont été testées puis écartées par la mesure.
- **Action** : échantillonnage du terminal toutes les 15 s pendant le premier chargement d'un
  modèle Vite + shadcn (`ui-captures/install_diag.py`). Aucun changement de code.
- **Preuve** : à 15 s le terminal affiche `npm install --no-audit --no-fund` ; à **30 s**
  l'installation finit et l'iframe de preview existe (`…--5173--…local-credentialless.webcontainer-api.io`).
  Vérifié ensuite visuellement : onglet Preview ouvert, URL `http://localhost:5173/`, page rendue.
  Écarté au passage : aucune erreur serveur, aucun 404 d'asset (pas d'onglet périmé), COEP
  correct pour Firefox desktop (`crossOriginIsolated = true` sous Gecko réel).
- **Conséquence** : **le premier chargement d'un projet prend 30-60 s** (installation + bundling).
  Ne jamais conclure à une panne avant d'avoir observé la sortie du terminal dans la durée.
  Ne pas confondre `NS_BINDING_ABORTED` (script de test qui ferme le contexte) avec un échec.
- **Commit** : aucun (diagnostic)
- **Reste ouvert** : aucun indicateur d'avancement n'affiche « installation en cours » au premier
  chargement ; l'utilisateur voit un écran qui peut sembler figé.

## 2026-10-16 — La synchro pouvait écraser une conversation pleine par une copie vide

- **Type** : fix
- **Contexte** : la base `bolt-history` (backend **PostgreSQL**, révélé par `/health` — la lecture
  directe du fichier SQLite induisait en erreur) contenait 10 enregistrements vides : 0 message,
  timestamp sentinelle `2026-01-01T00:00:00Z`, description « Conversation privée ». Ils
  réapparaissaient après suppression.
- **Action** : `pickNewest` ordonnait purement par date, donc une copie **vide** avec un horodatage
  récent battait une copie pleine et l'écrasait sur tous les appareils (le projet perd ses
  fichiers, le preview n'a plus rien à afficher). Boucle d'amplification : mettre en cache une
  copie distante vide la fait passer pour locale et la passe suivante la renvoie au serveur.
  Corrigé dans `app/lib/persistence/syncClient.ts` (le contenu gagne sur l'horodatage),
  `historySync.ts` (ne jamais pousser un local vide, ne jamais mettre en cache un distant vide,
  ne pas amorcer le cache sur un identifiant inconnu vide).
- **Preuve** : 2 des 4 nouveaux cas de `syncClient.spec.ts` sont **rouges** sur l'ancien
  `pickNewest` et verts après. Base assainie : 6 → 2 entrées, aucune réapparition après 45 s
  d'attente. tsc 0, `eslint app --quiet` 0.
- **Conséquence** : une conversation ne peut plus être effacée par une copie sans contenu.
- **Commit** : `1c4ee6e`
- **Reste ouvert** : la conversation signalée n'existait pas côté serveur (404) — si son cache
  local a déjà été écrasé, la restauration reste à confirmer.

## 2026-10-16 — Boutons de retour visibles dans l'en-tête (parité Lovable)

- **Type** : feat
- **Contexte** : demande utilisateur « il faut que les boutons apparents de retour soient
  disponibles ». Mesure DOM du site déployé : dans une conversation, l'en-tête ne contenait que
  le bouton de barre latérale et le logo (lien `/`). Aucun retour étiqueté, ni PC ni mobile.
- **Action** : nouveau `app/components/header/ProjectBackButton.client.tsx` (chevron étiqueté
  « Back to projects », ferme l'aperçu puis ouvre le panneau Projets) ; en-tête réorganisé façon
  Lovable : retour → barre latérale → logo → titre du projet centré → bouton `+` « New project ».
- **Preuve** : sur le site déployé, chevron visible et cliquable à 1440 (`[16,7,36,36]`) et à 390
  (`[8,7,36,36]`) ; le clic ouvre le panneau Projets (`[0,340]` / `[0,390]`). Géométrie d'en-tête
  à 390 : `overlap: []`, `scrollWidth == clientWidth == 390`, 0 débordement, 0 erreur JS.
  5 tests dédiés, `tsc` 0, `eslint` 0.
- **Conséquence** : une conversation a désormais un retour explicite et accessible (clavier inclus).
- **Commit** : `b43caf1`
- **Reste ouvert** : le titre du projet est tronqué à 390 px (52 px de large) — comportement voulu,
  à ajuster si l'utilisateur le juge gênant.

## 2026-10-16 — `import.meta.hot` est un objet VIDE sous Vitest (piège de testabilité)

- **Type** : trick
- **Contexte** : impossible d'écrire un test DOM pour un composant qui importe `workbenchStore` :
  la suite échouait à la collecte avec `Cannot read properties of undefined (reading 'X')`.
- **Action** : sous Vitest, `import.meta.hot` existe mais `import.meta.hot.data` est `undefined`,
  donc `import.meta.hot?.data.X` lève. Corrigé en `import.meta.hot?.data?.X` sur 16 sites
  (`app/lib/stores/*`, `app/lib/webcontainer/index.ts`, `app/components/chat/ToolInvocations.tsx`),
  et les gardes `if (import.meta.hot)` en `if (import.meta.hot?.data)`.
- **Preuve** : le test du bouton de retour passe (5/5) ; sans ce correctif il ne se collecte même pas.
  Aucun effet en production (Vite et wrangler définissent bien `.data`).
- **Conséquence** : les modules qui lisent l'état HMR sont désormais testables.
- **Commit** : `b43caf1`
- **Reste ouvert** : aucun.

## État du déploiement (à tenir à jour)

| Aspect | Valeur |
|---|---|
| Hôte | `169.58.18.46` — domaine `bolt.169-58-18-46.sslip.io` |
| Application | conteneur Docker `bolt-diy` (image `bolt-diy:local`), `127.0.0.1:5173`, derrière nginx |
| Identifiant | `BOLT_AUTH_USER` (voir `systemctl cat bolt-auth`) ; mot de passe dans `/opt/bolt/.bolt_password` |
| Historique | service `bolt-history` (127.0.0.1:8200, systemd), backend **PostgreSQL**, base `bolt_history` |
| Publication | service `bolt-publish` (systemd), sites servis sous `/container/<slug>/` |
| Branche | `main` (dépôt `alexandre-leng/bolt.diy`) |

## Stack verrouillée

| Composant | Version / choix |
|---|---|
| Runtime | Node 22, React Router 7 (mode Worker), build Cloudflare Worker |
| UI | UnoCSS, tokens `bolt-elements-*`, nanostores, framer-motion |
| Fournisseur LLM par défaut | OpenCode Go / `deepseek-v4.1-flash` (inlinés au build via `Dockerfile`) |
| Tests | Vitest (projets `node` et `dom` séparés) + Playwright pour le navigateur |

## Pièges déjà payés (ne pas les redécouvrir)

- **Provider OpenCode Go** : `x-opencode-session` obligatoire et stable par conversation ;
  `thinking` doit être désactivé (sinon 0 tool call) ; `tool_choice: 'required'` incompatible
  avec `thinking` activé.
- **COEP** : Firefox Android ne supporte pas `credentialless` (nginx renvoie `require-corp` pour
  cet UA). Firefox desktop le supporte.
- **Docker** : `docker compose up -d` peut répondre « Container … Running » **sans recréer** avec
  la nouvelle image — utiliser `--force-recreate` et vérifier l'horodatage de démarrage.
- **Déploiement** : chaque déploiement renomme tous les chunks hachés ; un onglet ouvert reste sur
  l'ancien build et affiche « No preview available ». Vérifier `awk '$9==404' /var/log/nginx/access.log`
  avant de chercher une régression.
- **Tests de performance** : `tests/performance/*` échouent sous charge parallèle ; les relancer
  seuls (`--no-file-parallelism`) avant de conclure.
- **Vision ≠ mesure** : un modèle de vision a décrit un en-tête « surchargé » que le DOM contredisait
  (`overlap: []`). Toujours trancher par une sonde DOM.
