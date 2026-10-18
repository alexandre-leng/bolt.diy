# Mémoire Externe Partagée — bolt.diy (fork auto-hébergé)

## 2026-10-18 — Relecture post-commit du lot documentation

- **Type** : verification.
- **Preuve distincte** : après le run complet 1201/1201, la relecture post-commit a donné 1200 verts / 1 échec sur `streaming-performance.perf.test.tsx`, mixed content (30,49 ms contre 16,67). Relance du fichier seul : 9/9 verts. Aucun seuil changé ni test exclu ; ce résultat est documenté séparément dans le guide, pas confondu avec le premier run.


## 2026-10-18 — Documentation du runtime réel et publication du lot validé

- **Type** : docs / fix / delivery.
- **Périmètre validé par Alex** : correctifs de l'audit, documentation, et les six fichiers UI/connecteurs non commités présentés avant la validation. Relecture et intégration dans le worktree isolé ; aucune modification des fichiers source de l'autre session.
- **Correction avant inclusion** : les callbacks Échap ajoutés dans ConfirmationDialog/SelectionDialog doublaient la fermeture Radix. Test rouge (`2` appels), correction supprimant les callbacks redondants, test vert (`1` appel). La palette utilise un vrai bouton clavier plutôt qu'un div role=button.
- **Connecteurs** : quatre tests supplémentaires vérifient le refus de get_token GitHub, les URLs GitLab littérales privées et l'absence de stack Supabase côté réponse. La validation GitLab seule ne prouve pas une protection SSRF complète contre DNS/redirects.
- **Documentation** : README aligné sur le runtime Docker/gVisor, suppression des affirmations WebContainer courantes, guide `docs/docs/self-hosted-bolt.md`, index `docs/README.md`. Séparation app/services externes, commandes réelles, tests, patches non appliqués automatiquement, reste de l'audit et absence de déploiement explicités. Les liens locaux ont été vérifiés.
- **Preuve finale** : types 0, lint 0, **1201 tests verts dans 145 fichiers**, build app 0. Contrôle de secrets sur le diff et les nouvelles docs/tests sans correspondance de valeurs de clés configurées.
- **Limite documentaire** : une tentative de mise à jour d'AGENTS.md a été refusée par le garde-fou (approbation expirée) ; fichier laissé intact, pas de contournement. Les versions effectives restent celles de package.json et du nouveau guide.
- **Travail parallèle apparu après le périmètre initial** : catalogue modèles OpenCode Go / générateur en cours dans `/opt/bolt/src` ; non intégré dans ce lot sans validation de son état fini. Le snapshot original des six fichiers est conservé hors dépôt pour traçabilité.
- **Déploiement** : aucun redémarrage de service ni application des patches ; un push GitHub ne vaut pas déploiement. L'audit complet reste ouvert.


## 2026-10-18 — Suite personnelle : une trame null faisait tomber bolt-runtime

- **Type** : fix.
- **Reproduction** : instance HTTP/WS isolée sur port éphémère, même handler `createApiHandler`, trame `null` : Node quittait en code 1 (`Cannot read properties of null (reading id)`). Aucun appel au service live ni accès Docker.
- **Correction** : validation d'enveloppe avant accès aux propriétés ; refus de null, tableaux, scalaires et id non fini. Module `src/requestValidation.ts` et vrai test WebSocket qui envoie null puis vérifie la réponse à l'opération suivante.
- **Preuve** : build runtime 0 ; 27/27 tests unitaires dont le socket réel ; sonde de crash relancée : code 0 et `RUNTIME_SURVIVED_MALFORMED_FRAME`.
- **Livraison** : commit local runtime `19e42fe` dans `/opt/bolt/wt-full-audit-runtime` (dépôt sans remote). Patch distribué dans le fork : `patches/runtime-websocket-envelope.patch`. Pas déployé : la confirmation d'IP est restée sans réponse, donc aucune mutation live.
- **Reste ouvert** : audit global non terminé ; UI/IA/ownership et courses de publication restent à vérifier. Les changements parallèles dans `/opt/bolt/src` ne sont pas intégrés ni écrasés.


## 2026-10-18 — Audit personnel : transport runtime, import ZIP et frontière de publication

- **Type** : fix / audit, première vague ; audit global non terminé.
- **Isolation** : branche `audit/full-stack-review` dans `/opt/bolt/wt-full-audit` ; services copiés dans `/opt/bolt/wt-full-audit-services`. Deux agents encore actifs arrêtés à la demande d'Alex ; aucune nouvelle délégation.
- **Runtime client** : les requêtes jamais envoyées survivent à une coupure ; `close()` rejette les attentes et la readiness au lieu de les laisser suspendues. Deux régressions rouges avant correction, vertes après ; changement de projet/reconnexion vérifié également (ce dernier chemin fonctionnait déjà).
- **ZIP** : sérialisation base64 commune aux restaurations ; test passant par le vrai parseur prouve la préservation du contenu et des fins de fichier. L'import de binaires reste volontairement hors de cette correction.
- **Mesure perf** : le test nommé streaming montait 100 racines React ; il utilise maintenant `rerender` sur une seule racine, garde le budget 16,67 ms et vérifie le DOM final. Aucun seuil relevé ni exclusion ajoutée.
- **Publication** : patch versionné `patches/publish-artifact-boundary.patch`. Les copies de dist ne suivent plus les symlinks sur le host (descripteurs relatifs et O_NOFOLLOW) ; token indisponible = échec sandbox, pas de repli implicite sur le host. Régressions rouges puis vertes. Validations concurrentes `parse_publish_body` conservées par resynchronisation depuis le service live.
- **Preuve** : `tsc --noEmit -p .` 0 ; `eslint app --quiet` 0 ; suite entière **1196/1196, 143 fichiers** ; `npm run build` 0. Patch appliqué sur copie fraîche des services : **64 tests, 2 ignorés, aucun échec** ; les tests live sont exclus de cette preuve.
- **Non livré en production** : aucun remplacement de service ni redémarrage ; domaine cible historique `bolt.169-58-18-46.sslip.io`, IP constatée `169.58.18.46`, confirmation préalable de déploiement à obtenir.
- **Reste ouvert** : audit complet des parcours réels/UI/IA, ownership/concurrence publication, import dossier, Electron/CI et autres constats statiques à reproduire. Ne pas traiter un rapport statique d'agent comme un bug confirmé : plusieurs pistes étaient fausses (messages déjà exclus des options, entrée DOM absente ne faisant pas échouer Vitest).
- **Incident de vérification** : une assertion de mock subprocess a imprimé des variables d'environnement dans une sortie outil. Assertion remplacée par un booléen sans impression des arguments ; rotation préventive des clés concernées à prévoir, aucune valeur conservée ici.


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

## 2026-10-17 — L'onboarding se réaffichait et n'était pas partagé entre appareils

- **Type** : feat + fix
- **Contexte** : le wizard (profil, fournisseur, apparence) stockait tout dans le navigateur. Sur un
  second appareil, tout était redemandé. Demande d'Alex : ce qui est saisi doit aller en base
  PostgreSQL, par compte, et ne jamais être redemandé.
- **Action** : `app/lib/accountSettings.ts` synchronise profil, drapeau d'onboarding et options
  d'interface vers `/api/auth/preferences` ; les clés API vont vers `/api/auth/secrets`, chiffrées
  côté serveur (AES-256-GCM, `BOLT_SECRETS_KEY` dans `/etc/bolt-accounts.env`). Le wizard consulte
  le compte avant de s'ouvrir, sauvegarde à la fin, et se pré-remplit depuis le compte.
- **Preuve** : sur un compte vierge, navigateur vierge : le wizard s'ouvre, les valeurs arrivent en
  base (`profileName`, avatar, `interfaceOptions`, `onboardingCompleted`), puis un second navigateur
  récupère le profil et l'apparence (accent 80, rayon round) sans rien redemander. 25/25 tests du
  module ; suite complète : 1110/1112, les 2 échecs ne touchent pas ces fichiers.
- **Piège n°1 (deux fois)** : l'application écrit ses propres défauts au démarrage. `mcp_settings` est
  posé à chaque lancement, et le cookie `apiKeys` est réécrit `{"<fournisseur>":""}` au montage du
  chat (`APIKeyManager` synchronise une valeur vide). Compter leur présence comme « setup existant »
  faisait croire qu'un compte neuf était configuré : le wizard ne s'ouvrait jamais. Règle : seul un
  signe saisi par l'utilisateur compte (profil non vide, clé non vide).
- **Piège n°2** : forcer `onboardingCompleted=true` lors d'une synchronisation marque un compte vierge
  comme configuré. Comme ce drapeau supprime le wizard partout, l'accès devient impossible. Le drapeau
  n'est donc envoyé que si un profil réel existe.
- **Piège n°3 (méthode)** : les diagnostics qui se connectaient avec le compte réel d'Alex ou
  réutilisaient une IndexedDB polluée ont produit de fausses conclusions. Pour un test de premier
  lancement, il faut un compte créé à l'instant et un contexte navigateur vierge.
- **Reste ouvert** : `create-summary.spec.ts` échoue (assertion de délai, fichier d'un autre agent,
  commit `f942ba8`) ; `pagiaRealReplay.spec.ts` ne charge pas (non suivi par git) ; test de perf
  flaky sous charge (connu). Cross-Origin-Opener-Policy toujours absent de nginx.
- **Commit** : `e82a868`

## 2026-10-17 — Correction du bilan de tests de l'onboarding compte

- **Type** : docs
- **Contexte** : l'entrée précédente annonçait « suite complète : 1110/1112, 2 échecs ». La relecture
  de la sortie complète (`npx vitest run`, 73 s) donne **4 échecs sur 1094 tests, 3 fichiers en échec**.
- **Preuve** : `Test Files 3 failed | 136 passed (139)`, `Tests 4 failed | 1090 passed (1094)`.
  Aucun échec ne porte sur `accountSettings`, `FirstRunOnboarding`, `entry.client` ou `preferences`
  (vérifié par filtrage des lignes FAIL).
- **Échecs connus, hors périmètre** :
  - `create-summary.spec.ts` : « Missing API key for OpenRouter provider » — le test ne fournit pas de
    clé ; fichier d'un autre agent (commit `f942ba8`).
  - `pagiaRealReplay.spec.ts` : le fichier ne charge pas ; non suivi par git.
  - `tests/performance/*` : fragiles sous charge parallèle (déjà documenté plus haut).
- **Leçon** : annoncer un chiffre de test sans relire la sortie complète a produit un bilan faux.
  Toujours citer la ligne `Tests N failed | M passed` telle quelle.
- **Reste ouvert** : ces 4 échecs ne sont pas réparés ; ils ne sont pas dans le périmètre de cette tâche.

## 2026-10-17 — Échecs de tests réparés : deux corrections de test, une exclusion documentée

- **Type** : fix (tests)
- **Contexte** : bilan de la suite complète `4 failed | 1090 passed`. Demande d'Alex : combler.
- **Action** :
  1. `create-summary.spec.ts` : le fournisseur par défaut est lu **à l'import** depuis
     `VITE_DEFAULT_PROVIDER` (`app/utils/constants.ts`). En test sans variable, il retombait sur
     OpenRouter → « Missing API key for OpenRouter ». Correction : `vi.hoisted` fixe la variable
     **avant** les imports. Un `beforeAll` aurait été trop tard, car la valeur est déjà figée.
     Preuve : passe avec les variables **non définies** (1/1).
  2. `pagiaRealReplay.spec.ts` : ce n'est pas un test unitaire. Il rejoue `/tmp/pagia_chat.json`,
     un export de conversation réelle absent du dépôt et vide sur le disque (0 octet). Exclu de la
     suite par défaut, avec la raison écrite à côté, pour qu'il reste lançable à la main.
- **Non réparé, volontairement** : `streaming-performance` (budget de frame 16,67 ms, mesuré 23 ms
  sous charge, passe seul). Relever le seuil masquerait une vraie régression ; c'est un test de
  temps réel dépendant de la machine.
- **Preuve** : suite complète `1 failed | 1145 passed (1146)`, contre `4 failed | 1090 passed (1094)`
  avant. Commit `42af462`, poussé, SHA vérifié.
- **Reste ouvert** : le test de frame `streaming-performance` ; la COOP absente de nginx.

## 2026-10-17 — Deux modes dans l'interface : generer un design, ou partir d'une image

- **Type** : feat
- **Contexte** : Alex veut deux entrees possibles et un choix VISIBLE dans l'UI (pas un menu
  deroulant) : (1) decrire une page -> obtenir 3 maquettes -> en choisir une -> elle devient un
  site ; (2) partir d'un screenshot existant. Et il veut pouvoir continuer a prompter Bolt
  ensuite, comme d'habitude.
- **Action** :
  1. `app/lib/screenshot/designs.ts` : generation de maquettes par prompt. Chaque variante porte
     une direction artistique DIFFERENTE (minimal / contraste / chaleureux / dense) pour que le
     choix soit un vrai choix, et non N tirages de la meme idee.
  2. `app/routes/api.screenshot.designs.ts` : route serveur qui appelle OpenAI Images. La cle
     reste cote serveur (le navigateur n'envoie qu'un prompt et recoit du base64). Plafond par IP
     (8 requetes / 10 min) car chaque appel coute de l'argent, et `dall-e-3` renvoie parfois une
     URL : elle est telechargee pour ne renvoyer qu'une seule forme au client.
  3. `ScreenshotToCode.tsx` : selecteur de mode en DEUX CARTES (icone + titre + description +
     coche), pas une liste deroulante. Mode design = zone de prompt -> maquettes cliquables en
     grille -> conversion. Mode image = upload direct. Les deux passent par `runGeneration`,
     donc un pipeline unique et deux entrees.
- **Preuve** : 41/41 tests verts sur le module (dont : les deux modes sont visibles et exclusifs,
  le basculement change les entrees affichees, une maquette choisie passe par le MEME pipeline
  qu'une image uploadee). `tsc --noEmit` 0. Cle OpenAI verifiee en direct : HTTP 200, base64
  renvoye.
- **Conséquence** : le workflow complet d'Alex est disponible : prompt -> maquettes -> choix ->
  site -> puis on continue a prompter Bolt dans le chat.
- **Commit** : a venir.
- **Reste ouvert** : (a) le mode image de l'upstream (`inputMode: 'video'`, `generationType:
  'update'`) est pret cote client mais sans ecran ; (b) les 6 stacks ne sont pas tous testes
  jusqu'au rendu du projet genere dans Bolt ; (c) la cle OpenAI est facturee a l'usage : surveiller
  le plafond par IP.
- **Piège** : `isImageGenerationEnabled` cote backend upstream ne genere PAS les maquettes a
  choisir ; il genere les images *dans* la page produite (heros, illustrations). Confondre les deux
  fait chercher la fonctionnalite au mauvais endroit — celle d'Alex a du etre ecrite.

## 2026-10-16 (nuit) — Refacto client screenshot-to-code : variantes multiples et flux complet

- **Type** : refactor
- **Contexte** : le backend envoie bien plus que ce que le client comprenait. Mesure reelle du
  flux : `variantCount`, `status`, `thinking`, `toolStart`, `toolResult`, `setCode`, `assistant`,
  `variantComplete`. Le client n'en traitait que 4 et resolvait sur UNE seule chaine, donc :
  une variante gardee sur 4, aucune progression visible au-dela d'un statut generique, aucune
  trace du raisonnement, et une generation de plusieurs minutes qui semblait figee.
- **Action** :
  1. `generate.ts` : la promesse resout desormais `Variant[]` (toutes les variantes valides,
     triees par index) au lieu d'une chaine. Nouveau `onEvent` qui remonte chaque frame
     (`status`, `variantCount`, `thinking`, `toolStart`, `toolResult`, `setCode`, `assistant`,
     `variantComplete`, `variantError`). Exposes : `STACKS` (6), `INPUT_MODES` (3),
     `generateMany` pour le mode texte et les images multiples. Nouvelle capacite :
     `generationType: 'update'`, `designSystem`. Le repli sur les `setCode` recus quand la
     connexion se ferme sans `variantComplete` est sur : le backend envoie `setCode` en UN
     message complet, et `validateGeneratedHtml` exige `<!doctype html>` ET un `</html>` final.
  2. `ScreenshotToCode.tsx` : selecteur de stack, journal de progression repliable
     (`thinking`, outils, nombre de designs), et selection parmi les designs generes avec
     apercu et import du design choisi.
- **Preuve** : 35/35 tests verts sur `app/lib/screenshot` + `ScreenshotToCode` (3 nouveaux tests
  couvrent les variantes multiples, le flux riche et le choix de stack). `tsc --noEmit` : 0
  erreur. Un test au comportement inverse a ete corrige EN CONSCIENCE : « never returns partial
  code » exigeait un rejet quand la connexion se ferme sans `variantComplete` ; il est remplace
  par un test qui accepte un document COMPLET et un autre qui rejette un document TRONQUE.
- **Conséquence** : les 4 designs du backend sont enfin visibles et selectionnables, et une
  generation longue montre sa progression.
- **Commit** : a venir.
- **Reste ouvert** : (a) generation d'images (prompt -> 4 designs) non branchee ; (b) seules les
  capacites `create` sont exposees dans l'UI (le client sait envoyer `update` mais l'ecran
  correspondant n'existe pas) ; (c) STACKS couvre 6 valeurs mais le rendu d'un projet React/Vue
  dans Bolt n'est pas teste.
- **Piège** : un mock de test qui emet `onEvent` SYNCHRONEMENT depuis la fabrique echoue alors que
  le vrai backend emet apres l'ouverture du socket. Emettre dans un `act()` apres avoir attendu
  l'appel, sinon l'evenement arrive avant l'enregistrement de l'etat.

## 2026-10-16 (nuit) — screenshot-to-code : le backend n'existait pas, il tourne maintenant

- **Type** : feat / deploy
- **Contexte** : le fork contenait un client `screenshot-to-code` complet (generate.ts, composants,
  tests) qui appelait `wss://<host>/screenshot-api/generate-code` — une route qui **n'existait
  nulle part** : aucun service, aucune route nginx, port 7001 ferme. La fonction etait donc morte
  a l'usage (`Connection failed`) alors que le code semblait livre.
- **Action** :
  1. venv Python 3.12 dans `backend/.venv` via `uv` (le projet est en Poetry avec
     `package-mode = false` : `uv pip install -r pyproject.toml` echoue avec « Building a package
     is not possible in non-package mode » ; installer les dependances explicitement).
     Dependances reelles au-dela de la liste : `playwright` et `langfuse` sont importes par
     `main.py` de facon non optionnelle.
  2. Unite `screenshot-api.service` : `User=boltsites`, `ProtectSystem=strict`,
     `ProtectHome=yes`, `MemoryMax=2G`, `CPUQuota=200%`, secrets dans
     `/etc/screenshot-api.env` (600 root:root) charge par `EnvironmentFile`.
  3. Route nginx `/screenshot-api/` : `auth_request /_bolt_auth`, upgrade WebSocket
     (`proxy_http_version 1.1` + `Upgrade`/`Connection`), `proxy_read_timeout 600s`,
     `proxy_buffering off`, `client_max_body_size 32m`. Sans la session, la route repond 302.
- **Preuve** : `GET /` -> 200 ; WebSocket teste D'ABORD en boucle locale, PUIS a travers nginx
  avec une vraie session (`bolt_account_session`) : handshake OK, `variantCount: 4`,
  `variantComplete`, code de 804 caracteres. Le code produit correspond a l'image envoyee
  (rectangle bleu, texte « Landing page test », rectangle gris aux bonnes coordonnees) :
  la conversion image -> code fonctionne reellement.
- **Conséquence** : la fonction est utilisable pour la premiere fois. Le backend survit au reboot
  (`systemctl enable`).
- **Commit** : backend hors depot git (`/opt/bolt/vendor/`) — seuls memory.md et le client Bolt
  sont versionnes.
- **Reste ouvert** : (a) le flux reel est bien plus riche que ce que le client comprend — le
  backend envoie `variantCount`, `thinking`, `toolStart`, `toolResult`, `assistant`, et
  `generate.ts` n'en traite que 4 (`status`, `setCode`, `variantComplete`, `variantError`) :
  sans refacto, aucune progression, aucun raisonnement et une seule variante sur 4. (b) Le client
  n'expose qu'UNE stack sur 6 (`html_tailwind`), UN mode sur 3 (`image`), UN type sur 2
  (`create`). (c) Generation d'images (prompt -> 4 designs) pas encore branchee :
  l'upstream passe par Replicate, le workflow voulu par Alex est OpenAI Images.
- **Piège** : un client sans serveur est livre « vert » par les tests et casse en production. Un
  WebSocket vers une route inexistante echoue silencieusement. Verifier que la route appelee
  existe (nginx + service + port) avant de croire une integration terminee.

## 2026-10-16 (soir) — Durcissement sécurité : isolation du code non fiable, comptes, plafonds

- **Type** : fix / decision
- **Contexte** : audit 360 demandé. Le point le plus grave : `bolt-publish` et
  `bolt-private-preview` **exécutent du code fourni par l'utilisateur en root**. Un
  `vite.config.ts` ou un plugin est du code qui s'exécute pendant le build, quoi que dise la
  liste `allow-scripts` du `.npmrc` : cela donnait un accès en lecture à
  `/opt/bolt/.env.local` et `/root/.hermes/.env` (clés API) et un accès en écriture au host.
- **Action** (lots 1-6) :
  1. Utilisateur système `boltsites` (uid 997) propriétaire de `/srv/bolt-sites` seulement.
     Node **déplacé** de `/root/.hermes/tools/` vers `/opt/bolt/tools/` : `ProtectHome=yes`
     rend `/root` invisible, un binaire qui y vit casse tout build.
  2. `bolt-publish` et `bolt-private-preview` : `User=boltsites`, `ProtectSystem=strict`,
     `ProtectHome=yes`, `PrivateTmp=yes`, `NoNewPrivileges=yes`, `MemoryMax=1G`,
     `CPUQuota=200%`, `TasksMax=256`. `ProtectSystem=strict` + `ReadWritePaths=` remplace le
     `ProtectSystem=false` historique, qui existait parce qu'un `full` faisait sortir npm en 0
     sans rien écrire (faux « bug de build »).
  3. Comptes : les 5 fixtures de test supprimées (`bolt-test-*`, `brute-*`, `other-*`,
     `third-*` dont deux `is_admin=true` actifs), `alexandre@lengereau.fr` nommé en exclusion
     explicite dans le WHERE. Hash vérifié identique avant/après.
  4. Plafonds dans `bolt_publish.py` : refus si moins de 2 G libres, max 50 sites, source
     limitée à 200 Mo, `node_modules` supprimé après chaque build (le suivant réinstalle).
  5. SSH : `PermitRootLogin prohibit-password`, `X11Forwarding no`, `MaxAuthTries 4`,
     `PermitEmptyPasswords no` via `sshd_config.d/99-hardening.conf` (nommé 99 pour avoir le
     dernier mot : cloud-init réécrit `50-cloud-init.conf` au boot).
  6. CSP servie en **Report-Only** (`Content-Security-Policy-Report-Only`) : une politique
     fausse ne dégrade pas, elle blanchit silencieusement la preview WebContainer, l'échec le
     plus dur à attribuer du produit. À passer en enforce après observation.
- **Preuve** : build réel sous durcissement via `systemd-run` avec les mêmes options —
  `node_modules/vite PRESENT`, `dist/index.html` créé, marqueur présent ; `/opt/bolt/.env.local`
  NON lisible ; écriture dans `/opt/bolt` et `/root` refusée. Publish via l'API réelle :
  `npm install -> 0`, `vite build -> 0`, site servi 200, `node_modules` nettoyé. 765 Mo libérés,
  les 5 sites publiés répondent 200. `systemctl show` confirme les valeurs effectives.
- **Conséquence** : le code généré ne peut plus lire les secrets du host ni écrire hors de son
  répertoire de build. 5 comptes dont 2 admin supprimés. Disque sous surveillance.
- **Commit** : non versionné (units systemd + service hors dépôt git) — seuls les changements
  de `bolt_publish.py` sont dans `/opt/bolt/publish/`.
- **Reste ouvert** : (a) **`PasswordAuthentication no` NON activé** — la clé privée n'existe pas
  sur ce serveur, donc la connexion par clé n'a pas pu être testée d'ici ; la couper sans
  vérification depuis le poste d'Alex risque un lockout. Marche à suivre : Alex teste
  `ssh -i <sa clé> root@169.58.18.46` depuis son poste, puis on passe le 99-hardening.conf en
  `PasswordAuthentication no` + `systemctl reload ssh`. (b) CSP à passer en enforce après
  observation. (c) La sandbox vraiment jetable par build (conteneur éphémère, sans secrets,
  réseau filtré) reste le vrai remède pour accepter des projets inconnus ; le durcissement
  systemd est le minimum pour du semi-fiable.
- **Piège** : un service qui exécute du code utilisateur en root est un chemin de compromission
  du host, pas un réglage de permissions. Ne jamais conclure « le build réussit donc c'est
  isolé » : un `dist/` filtré et un HTTP 200 ne prouvent rien sur l'isolation.

## 2026-10-16 (soir) — Un projet construit en mode Agent revenait au template après réouverture

- **Type** : fix (correctif principal de la session)
- **Contexte** : « le preview affiche la page d'accueil du template alors que Publier envoie le
  bon site ». Mesure : conversation « Pagia » (9 messages) — les outils `project_write_file` ont
  bien écrit App/Builder/ContactsHub/Pricing/FAQ/Footer ; le snapshot IndexedDB, lui, date d'avant
  ces tours.
- **Action** : quatre défauts indépendants, chacun suffisant à reproduire le symptôme.
  1. **Rien ne rejouait les écritures de l'agent.** Seuls les `<boltAction>` sont rejoués à
     l'ouverture ; en mode Agent le modèle écrit par des appels d'outils, jamais rejoués.
     `app/lib/persistence/agentFileReplay.ts` replie `project_write_file` / `project_patch_file` /
     `project_delete_path` sur toute la conversation et réémet le résultat en artefact non stocké.
     Un patch dont la base est inconnue n'est **jamais** deviné : le fichier est laissé seul.
  2. **La restauration abîmait les fichiers** : le contenu était inséré brut dans
     `<boltAction>`, donc `cleanEscapedTags` transformait `&lt;` en `<`, les blocs de code
     entourant un fichier entier étaient retirés, un `\n` ajouté, et les binaires écrits en
     texte. Bolt génère désormais des actions `encoding="base64"` (`app/utils/base64Utf8.ts`) et
     le parseur les écrit octet pour octet.
  3. **« Continue » après une coupure supprimait le tour de l'agent**, y compris ses écritures
     déjà exécutées (`dropFailedTurn` garde les appels d'outils aboutis).
  4. **La sauvegarde s'arrêtait** si le dernier message s'allongeait sans nouveau message
     (`messagesChangedSinceLoad` remplace `messages.length > initialMessages.length`).
- **Preuve** : 26 tests ajoutés ; régressions **rouges** prouvées sur l'ancien code : parser
  base64 (1), `projectMcp` révision (2), publish secrets (3), history 401/newline (5),
  `errors.ts` classification (2), replay sur la vraie conversation « Pagia » (App + 6 fichiers
  reconstruits, `unresolved: []`). Suite complète **912/912**, `tsc` 0, eslint 0, image
  reconstruite et déployée.
- **Conséquence** : rouvrir un projet de l'agent affiche le projet, même dans un navigateur qui
  n'a jamais construit ce chat (le serveur ne stocke toujours pas les snapshots).
- **Commit** : `b44c862` (+ `d8b82e6` fusion, `d548ee4` alignement).
- **Reste ouvert** : les snapshots de projet restent en IndexedDB (décision serveur non tranchée)
  ; les binaires du watcher sont toujours stockés `content: ''` ; `waitForExecutionQueue` ne
  ré-attend pas les mutations arrivées pendant l'attente.
- **Piège** : l'artefact synthétique `restored-agent-files` a collisionné avec la correction de
  publication de l'autre branche, qui détectait « l'artefact de restauration » par la chaîne
  `restored-project-setup` — sans la liste commune (`restoreArtifacts.ts`), le site publié aurait
  été nommé « Restored project files » et le garde anti-publication pendant la restauration n'aurait
  pas joué. Tout nouvel artefact synthétique doit y être ajouté (verrouillé par un test).

## 2026-10-16 (soir) — Services Python : 401, newline, broken pipe, HEAD, secrets publiés

- **Type** : fix (services `bolt-history`, `bolt-accounts`, `bolt-publish`, `bolt-private-preview`)
- **Contexte** : audit de sécurité + lecture des journaux (tracebacks `BrokenPipeError`,
  `PUT /history/1` 500, `HEAD /login` 501).
- **Action** :
  1. `bolt_history.py` : sans `X-Bolt-User-Id`, `''::uuid` explosait en **500** — `_require_owner`
     répond désormais **401** (GET liste, GET chat, PUT, DELETE) ; une description avec retour à la
     ligne cassait le script psql (`\set` lu ligne à ligne) — nettoyée, plus une garde qui lève une
     erreur lisible ; `_send` ignore `BrokenPipeError`/`ConnectionResetError`.
  2. `bolt_publish.py` : la publication copiait **tout** le projet, `.env`, `.git/config` et clés
     comprises, dans un dossier servi publiquement — `scrub_public()` appliqué à la copie statique,
     au dossier `dist/` après `vite build` et au fallback (dotfiles sauf `.well-known`, `*.key`,
     `*.pem`, `id_rsa*`).
  3. `private_preview.py` : le filtre `.env` comparé **tel quel** (`.ENV` passait) → insensible à
     la casse + matériaux de clé.
  4. `accounts` : open redirect post-connexion (`/\evil.com` accepté par `startswith("/") and not
     startswith("//")`, et les navigateurs normalisent `\` en `/`) → `safe_redirect_target` ;
     `do_HEAD = do_GET` (`HEAD /login` répondait **501 en production**, constaté par `curl -I`).
  5. nginx : `location ~ ^/container/[^?]*/\. { return 403; }` — les sites publiés **avant** le
     correctif gardaient leurs dotfiles.
- **Preuve** : 38/38 history (5 rouges avant), 38/38 publish+preview (3 rouges avant), 6/6
  accounts (le test documente que l'ancienne garde acceptait le cas), 11/11 secret_crypto.
  Live après redémarrage : `HEAD /login` **200** (était 501), `/container/<slug>/.probe-secret`
  **403** avec le fichier normal à **200**. Sauvegardes dans
  `/root/.hermes/cache/scratch/svc-backup-1914/`.
- **Reste ouvert** : `bolt-private-preview` et `bolt-publish` tournent toujours en **root** sans
  plafond mémoire (décision à valider) ; deux comptes de test **admin** dorment dans la base de
  prod ; SSH reste en auth par mot de passe (aucune clé présente : ne rien couper sans clé).
- **Piège** : `curl http://<ip-publique>:<port>/` **depuis la machine elle-même** prouve
  l'absence de rien — le trafic ne quitte jamais la machine. `iptables -P INPUT DROP` +
  `ufw` (22/80/443 seulement) étaient la preuve réelle, pas la sonde.

## 2026-10-16 (soir) — Pipeline LLM : log du prompt complet, repli de modèle ignoré, erreurs mal classées

- **Type** : fix
- **Action** :
  1. `stream-text.ts` loguait les options **entières** (prompt système, credos Supabase, schémas
     d'outils) deux fois par appel — environ **1 860 lignes de journal par requête**. Passé par
     `summarizeOptionsForLog` : scalaires gardés, le reste réduit à `<string 8712>` / `<object 7 keys>`.
  2. `create-summary.ts` / `select-context.ts` calculaient un repli de modèle puis envoyaient
     quand même le **nom inconnu** au fournisseur → 4xx « model not found » ; ils utilisent
     `modelDetails.name`.
  3. `errors.ts` : `Network connection lost` (casse) tombait dans le message générique
     « vérifiez vos réglages fournisseur » ; un 429 « tokens per minute » tombait dans « la
     conversation est trop longue ». Le 429 est testé avant « token limit », et le classement
     réseau utilise `normalizedMessage`.
- **Preuve** : `errors.spec` 12/12, 2 rouges sur l'ancien code ; `stream-text.log.spec` 2/2.
- **Reste ouvert** : les marqueurs `[Model: …]` / `[Provider: …]` partent toujours au modèle ;
  `toolChoice` nommé pour `agent_plan` reste la cause probable des `AI_ToolChoiceViolationError`
  ; `x-opencode-session` reste identique pour tous les comptes.

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
