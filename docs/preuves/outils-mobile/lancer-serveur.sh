#!/usr/bin/env bash
# Serveur Next LOCAL de recette : base jetable 127.0.0.1:55439/gamenight_preuves, tous les *_ENABLED à true,
# aucune clé externe (Discord, Steam, IGDB, Vercel, Neon absents) et sortie réseau neutralisée (proxy mort).
set -euo pipefail
cd "$(dirname "$0")/../.."
for f in .env .env.local .env.development .env.development.local; do [ -e "$f" ] && { echo "Environnement non isolé : $f"; exit 1; }; done
FLAGS=$( { grep -ohE '^[A-Z][A-Z0-9_]*_ENABLED' .env.example; grep -rhoE 'process\.env\.[A-Z0-9_]*_ENABLED' src | sed 's/process\.env\.//'; } | sort -u)
for f in $FLAGS; do export "$f=true"; done
export TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_preuves
export DATABASE_URL="$TEST_DATABASE_URL"
export AUTH_SECRET="${AUTH_SECRET:-$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")}"
echo "$AUTH_SECRET" > /tmp/preuves-auth-secret
export AUTH_URL=http://127.0.0.1:3102 AUTH_TRUST_HOST=true
export DISCORD_CLIENT_ID=local-unused DISCORD_CLIENT_SECRET=local-unused
export HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost
export NEXT_TELEMETRY_DISABLED=1
echo "$FLAGS" | wc -l | xargs echo "interrupteurs *_ENABLED mis à true :"
exec node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3102
