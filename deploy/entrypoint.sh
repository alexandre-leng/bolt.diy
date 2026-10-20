#!/bin/sh
set -e

# Le build react-router génère ../../.wrangler/deploy/config.json (chemin relatif
# au CWD /app/build/server) qui entre en conflit avec build/server/wrangler.json.
# On le retire : la config locale générée suffit pour servir le Worker en local.
rm -rf /app/.wrangler/deploy

cd /app/build/server

# ---------------------------------------------------------------------------
# Expose l'environnement au Worker.
#
# Un Cloudflare Worker ne lit PAS process.env : la seule voie est le binding
# `env`. Par défaut `wrangler dev` ne transmet que ce qui est déclaré en `vars`.
# Sans ce bloc, une clé posée dans .env.local (le chemin de déploiement
# documenté) arrive bien à Node mais jamais au Worker : chaque provider répond
# « api key not set » et /api/chat échoue.
#
# POURQUOI UN FICHIER ET PLUS `--var` :
# `--var NAME:value` met le secret dans argv de workerd. `docker top` (et tout
# `/proc/<pid>/cmdline` lisible) l'affichait donc en clair. `dev.vars` est le
# mécanisme officiel de wrangler : il est lu depuis le disque, alimente le
# binding `env` du Worker à l'identique, et n'apparaît dans aucune ligne de
# commande. Le fichier est écrit en 0600 et supprimé à l'arrêt du conteneur,
# donc il ne survit pas dans la couche d'image.
#
# Les valeurs sont lues sur l'environnement au démarrage du conteneur : changer
# une clé dans .env.local ne demande qu'un redémarrage, pas un rebuild.
# ---------------------------------------------------------------------------
DEV_VARS=/app/build/server/.dev.vars

: > "$DEV_VARS"
chmod 600 "$DEV_VARS"

cleanup() {
  rm -f "$DEV_VARS"
}
trap cleanup EXIT INT TERM

for name in \
  OPENCODE_GO_API_KEY \
  OPENCODE_GO_API_KEY_2 \
  OPENCODE_GO_API_KEY_3 \
  OPENCODE_GO_API_BASE_URL \
  OPENAI_API_KEY \
  OPENAI_BASE_URL \
  ANTHROPIC_API_KEY \
  GROQ_API_KEY \
  GOOGLE_GENERATIVE_AI_API_KEY \
  OPEN_ROUTER_API_KEY \
  DEEPSEEK_API_KEY
do
  value=$(printenv "$name" 2>/dev/null || true)

  # Les valeurs sont écrites telles quelles : aucune expansion shell, aucun
  # guillemet, aucune valeur par défaut (sinon wrangler échoue sur les « $ »
  # d'une clé). Les caractères spéciaux sont échappés une seule fois.
  if [ -n "$value" ]; then
    escaped=$(printf '%s' "$value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
    printf '%s="%s"\n' "$name" "$escaped" >> "$DEV_VARS"
  fi
done

exec /app/node_modules/.bin/wrangler dev --port 5173 --ip 0.0.0.0 --local --no-show-interactive-dev-session
