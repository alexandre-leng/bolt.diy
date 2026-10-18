# bolt-accounts — système de comptes

> **Cette copie n'est pas ce qui s'exécute.** Le service tourne depuis `/opt/bolt/accounts/` sur
> le VPS. Ce dossier met le code sous contrôle de version ; il a été copié depuis le VPS et vérifié
> identique octet pour octet. Modifier les deux ensemble (`cmp` fichier par fichier), puis
> `systemctl restart bolt-accounts` (une route ajoutée répond 404 tant que l'unité n'est pas
> redémarrée). Volontairement absents : `set_admin_email.py` et `verify_admin_login.py` (scripts
> d'exploitation à usage unique, adresses réelles), `__pycache__/`, et toute valeur de
> configuration — `BOLT_SECRETS_KEY` vit dans `/etc/bolt-accounts.env` et n'est jamais committée.

## Secrets chiffrés par utilisateur

| Endpoint | Rôle |
|---|---|
| `PUT /api/auth/secrets` | Chiffre (AES-256-GCM) et enregistre ; fusion, n'efface pas les absents. |
| `GET /api/auth/secrets` | **Noms** des secrets existants, jamais les valeurs. |
| `GET /api/auth/secrets?name=provider_settings` | Valeur déchiffrée de **ce seul** secret (les clés des fournisseurs de modèles), pour le compte connecté. |
| `DELETE /api/auth/secrets` | Supprime ; répond le nombre de lignes réellement supprimées. |

Sans la lecture de `provider_settings`, un second appareil apprenait qu'une clé existait sans pouvoir
l'obtenir, et chaque requête au modèle y échouait. Les jetons de connexion (GitHub, GitLab, Netlify,
Vercel, Supabase, MCP) restent **en écriture seule** : `READABLE_SECRET_NAMES` dans `handlers.py`
est la liste blanche de lecture.

Tests : `test_secret_read.py`, `test_secrets_hostile.py`, `test_secret_crypto.py`, à lancer avec
`BOLT_ACCOUNTS_TEST_DB=<base privée>` (la suite refuse `bolt_history`) et `/usr/bin/python3`.

## Ce qui tourne où

| Composant | Où | Rôle |
|---|---|---|
| `bolt-accounts` | 127.0.0.1:8210 (systemd) | Comptes, sessions, pages, emails |
| `bolt-history` | 127.0.0.1:8200 (systemd) | Historique des conversations + projets publiés |
| PostgreSQL 18.6 | 127.0.0.1:5432, base `bolt_history` | Toutes les données |
| nginx | 443 | Seule entrée publique ; `auth_request` → `/verify` de bolt-accounts |

## Variables d'environnement (`/etc/bolt-accounts.env`, chmod 600)

- `BOLT_HISTORY_PG_HOST` / `_PORT` / `_USER` / `_DB` / `_PASSWORD` — accès PostgreSQL
- `BOLT_ACCOUNTS_PORT` — 8210 en interne
- `BOLT_PUBLIC_ORIGIN` — origine utilisée dans les liens envoyés par email
- `RESEND_API_KEY`, `EMAIL_FROM` — transport email (domaine `lengereau.fr`, vérifié chez Resend)

Le cookie de session s'appelle `bolt_account_session` — **pas** `bolt_session`, nom déjà pris par
l'ancien service de mot de passe unique ; deux services écrivant le même cookie se écrasaient et
une connexion valide bouclait entre `/login` et `/`.

## Migrations

```bash
cd /opt/bolt/auth-db
export BOLT_HISTORY_PG_PASSWORD=...
python3 apply.py --status     # état des migrations
python3 apply.py              # applique les manquantes (idempotent)
```

## Sauvegardes

```bash
pg_dump -h 127.0.0.1 -U bolt_history bolt_history | gzip > /var/backups/bolt-$(date +%F).sql.gz
```

Restauration testée : `createdb bolt_restore && gunzip -c <fichier> | psql -d bolt_restore`.

## Tests

```bash
cd /opt/bolt/accounts && BOLT_HISTORY_PG_PASSWORD=... /usr/bin/python3 test_accounts_e2e.py
cd /opt/bolt/history  && BOLT_HISTORY_PG_PASSWORD=... python3 -m unittest test_bolt_history
```

## Points d'attention

- `argon2-cffi` est installé pour **`/usr/bin/python3`**, pas pour le Python de Hermes. Les
  unités systemd appellent `/usr/bin/python3` explicitement.
- Resend refuse l'agent utilisateur par défaut d'`urllib` (403 « error code: 1010 ») : un
  `User-Agent` explicite est envoyé.
- La promotion/déclassement du dernier administrateur est refusée : impossible de se verrouiller
  hors de l'administration.
