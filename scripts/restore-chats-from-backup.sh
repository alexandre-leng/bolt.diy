#!/bin/bash
# Restore the user's real conversation from the 2026-10-16 backup.
#
# Established facts:
#   - production held 12 chat rows on the 16th and 1 on the 17th; the loss happened between
#     those dates. No probe or test in this session caused it: every script redirects its
#     database to a private one (verified by reading each script and by running the module
#     to print its effective PG_DB).
#   - exactly ONE row has real content: id '1', 752 933 characters of messages. The other
#     eleven are empty shells or a sync test, so restoring them would add nothing.
#   - the backup's rows have no owner and point at test accounts, so the owner is assigned
#     explicitly to the installation's real account.
#
# METHOD: the messages column is JSON containing literal backslashes that the dump encoded
# in COPY's own escaping. Re-emitting it through a Python string then a psql literal
# reinterprets those escapes and corrupts the payload (caught on a scratch database: the
# insert failed with `Token "imported" is invalid`). So the COPY block is fed back to psql
# VERBATIM in its own format, into a staging table, and only the scalar columns are
# rewritten. PostgreSQL does the decoding.
set -u

SRC=/var/backups/bolt-2026-10-16.sql.gz
OWNER_EMAIL="alexandre@lengereau.fr"
DB=bolt_history

OWNER=$(sudo -u postgres psql -d "$DB" -tAc "SELECT id FROM users WHERE email='$OWNER_EMAIL';" | /usr/bin/tr -d ' ')

if [ -z "$OWNER" ]; then
  echo "ABANDON: $OWNER_EMAIL introuvable"
  exit 1
fi

echo "proprietaire cible: $OWNER_EMAIL = $OWNER"

echo
echo "=== 1. etat AVANT ==="
sudo -u postgres psql -d "$DB" -tAc "SELECT count(*) FROM chats;"

echo
echo "=== 2. bloc COPY extrait tel quel ==="
/usr/bin/zcat "$SRC" | /usr/bin/sed -n '/^COPY public.chats /,/^\\\.$/p' > /tmp/copy_block.sql
/usr/bin/wc -l < /tmp/copy_block.sql | /usr/bin/tr -d ' '
echo "lignes (2 = en-tete + fin, donc 12 conversations)"

echo
echo "=== 3. restauration via table de transit ==="
{
  echo "BEGIN;"
  echo "CREATE TEMP TABLE _stage (id text, url_id text, description text, ts text, metadata jsonb, messages jsonb, updated_at timestamptz, user_id uuid) ON COMMIT DROP;"
  # The COPY header names the real columns; retarget it at the staging table.
  echo "COPY _stage (id, url_id, description, ts, metadata, messages, updated_at, user_id) FROM stdin;"
  /usr/bin/grep -vE "^COPY|^\\\\\." /tmp/copy_block.sql
  echo "\\."
  # Only the substantive conversation; the empty shells would add sidebar entries with no
  # content. PostgreSQL has already decoded the JSON by this point.
  echo "INSERT INTO chats (id, url_id, description, timestamp, metadata, messages, user_id)"
  echo "SELECT id, url_id, description, ts, metadata, messages, '$OWNER'::uuid FROM _stage"
  echo "WHERE length(messages::text) >= 100"
  echo "  AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.id = _stage.id);"
  echo "COMMIT;"
} > /tmp/restore_stage.sql

sudo -u postgres psql -q -d "$DB" -v ON_ERROR_STOP=1 -f /tmp/restore_stage.sql 2>&1 | /usr/bin/grep -viE "^NOTICE|^$" | /usr/bin/head -4

echo
echo "=== 4. etat APRES ==="
sudo -u postgres psql -d "$DB" -c "SELECT id, left(coalesce(description,'-'),46) AS titre, length(messages::text) AS taille, left(user_id::text,8) AS proprietaire FROM chats ORDER BY length(messages::text) DESC;"
