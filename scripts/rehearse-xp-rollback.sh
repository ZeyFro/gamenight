#!/usr/bin/env bash
# Répétition des retours arrière du lot XP + vocal sur un Postgres LOCAL jetable (jamais Neon, jamais Production).
# Usage : scripts/rehearse-xp-rollback.sh <base-modèle>   (base = baseline de main, SANS les 6 migrations, sur 127.0.0.1)
# Variables : PGHOST (défaut 127.0.0.1, refusé sinon), PGPORT (défaut 55439), PGUSER (défaut postgres).
set -euo pipefail
export PGPORT="${PGPORT:-55439}" PGUSER="${PGUSER:-postgres}" PGHOST="${PGHOST:-127.0.0.1}" PGOPTIONS='-c client_min_messages=warning'
[ "$PGHOST" = "127.0.0.1" ] || { echo "REFUS : seule la cible 127.0.0.1 est admise (PGHOST=$PGHOST)"; exit 2; }
TEMPLATE="${1:?base modèle (baseline de main)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGS=(20261019190000_separate_xp_balance 20261020150000_session_voice_presence 20261022120000_voice_presence_consent_coordination 20261022130000_voice_presence_retention_gap_bounds 20261022140000_voice_presence_gap_history 20261022142500_shop_balance_purchase_reason)
DOWN=("$ROOT"/scripts/rollback-xp-lot/0{6_shop_balance_purchase_reason,5_voice_presence_gap_history,4_voice_presence_retention_gap_bounds,3_voice_presence_consent_coordination,2_session_voice_presence,1_separate_xp_balance}.down.sql)
DB="xprb_$$"; TMP="$(mktemp -d)"
trap 'psql -qAt -d postgres -c "drop database if exists $DB" >/dev/null; rm -rf "$TMP"' EXIT
q() { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
fresh() { psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB template $TEMPLATE" >/dev/null; }
up() { for m in "${MIGS[@]}"; do q -1 -f "$ROOT/prisma/migrations/$m/migration.sql" >/dev/null
  q -c "insert into _prisma_migrations(id,checksum,migration_name,started_at,finished_at,applied_steps_count) values (gen_random_uuid()::text,'x','$m',now(),now(),1)" >/dev/null; done; }
dump() { pg_dump -s --no-owner -d "$DB" | grep -v '^--' | grep -v '^$' | grep -v '^\\\(un\)\?restrict' ; }
pass=0; fail=0
ok() { echo "OK   $1"; pass=$((pass+1)); }
ko() { echo "ECHEC $1"; fail=$((fail+1)); }
down_all() { for f in "${DOWN[@]}"; do q -f "$f" >/dev/null || return 1; done; }

# S1 : lot appliqué sans donnée applicative nouvelle -> retour arrière complet = schéma identique à la baseline
fresh; q -c "insert into \"User\"(id,\"discordId\",\"discordName\") select 'u'||g,'d'||g,'n' from generate_series(1,50) g" -c "insert into \"CommunityMemberStats\"(\"communityId\",\"userId\",\"xpTotal\") select 'c1','u'||g,g*10 from generate_series(1,50) g" >/dev/null
dump > "$TMP/base.sql"; rows_before=$(q -c 'select count(*), sum("xpTotal") from "CommunityMemberStats"')
up; [ "$(q -c "select count(*) from _prisma_migrations where migration_name like any (array['%separate_xp_balance','%session_voice_presence','%voice_presence_%','%shop_balance_purchase_reason'])")" = 6 ] || ko "S1 préparation (6 lignes attendues)"
if down_all; then dump > "$TMP/after.sql"
  if diff -q "$TMP/base.sql" "$TMP/after.sql" >/dev/null; then ok "S1 schéma identique à la baseline après retour arrière 6->1"; else ko "S1 schéma différent"; diff "$TMP/base.sql" "$TMP/after.sql" | head -20 || true; fi
  [ "$(q -c 'select count(*), sum("xpTotal") from "CommunityMemberStats"')" = "$rows_before" ] && ok "S1 données XP inchangées" || ko "S1 données XP modifiées"
  [ "$(q -c "select count(*) from _prisma_migrations where migration_name in ('${MIGS[0]}','${MIGS[1]}','${MIGS[2]}','${MIGS[3]}','${MIGS[4]}','${MIGS[5]}')")" = 0 ] && ok "S1 lignes _prisma_migrations supprimées" || ko "S1 lignes _prisma_migrations restantes"
else ko "S1 retour arrière en erreur"; fi

# S2 : le lot est rejouable après retour arrière
if up 2>"$TMP/err"; then ok "S2 lot rejoué après retour arrière"; else ko "S2 rejeu impossible : $(head -2 "$TMP/err")"; fi

# S3 : refus sur solde divergé (migration 1), achat au solde (6), données vocales (2 à 5)
fresh; up
q -c "insert into \"User\"(id,\"discordId\",\"discordName\") values ('u1','d1','n'),('u2','d2','n')" -c "insert into \"CommunityMemberStats\"(\"communityId\",\"userId\",\"xpTotal\",\"xpBalance\") values ('c1','u1',500,500),('c1','u2',300,300)" >/dev/null
q -c "insert into \"XpEvent\"(id,\"userId\",reason,\"sourceId\",amount,\"communityId\") values ('e1','u1','SHOP_BALANCE_PURCHASE','s1',-100,'c1')" -c "update \"CommunityMemberStats\" set \"xpBalance\"=400 where \"userId\"='u1'" >/dev/null
refuses() { if q -f "$1" >/dev/null 2>"$TMP/err"; then ko "$2 : devait refuser"; else grep -q 'Rollback interdit' "$TMP/err" && ok "$2 refuse (Rollback interdit)" || ko "$2 : échec inattendu : $(head -1 "$TMP/err")"; fi; }
refuses "$ROOT/scripts/rollback-xp-lot/06_shop_balance_purchase_reason.down.sql" "S3 retour 6 avec achat au solde"
# vocal : données présentes
q -c "insert into \"Session\"(id,date,\"createdById\") values ('s1',now(),'u1')" >/dev/null 2>"$TMP/err" || { echo "info: insertion Session minimale impossible, S3 vocal ignoré ($(head -1 "$TMP/err"))"; }
if q -c "select 1 from \"Session\" where id='s1'" | grep -q 1; then
  q -c "insert into \"SessionVoicePresenceControl\"(\"sessionId\") values ('s1')" -c "insert into \"SessionVoicePresenceGap\"(id,\"sessionId\",generation,\"startedAt\") values ('g1','s1',1,now())" >/dev/null
  refuses "$ROOT/scripts/rollback-xp-lot/05_voice_presence_gap_history.down.sql" "S3 retour 5 avec lacunes"
  # 5 autorisé explicitement (perte vocale acceptée), session partageant la connexion
  if printf "SET gamenight.allow_voice_data_loss = 'on';\n" | cat - "$ROOT/scripts/rollback-xp-lot/05_voice_presence_gap_history.down.sql" | q >/dev/null 2>"$TMP/err"; then ok "S3 retour 5 accepté avec allow_voice_data_loss"; else ko "S3 retour 5 autorisé en échec : $(head -1 "$TMP/err")"; fi
  refuses "$ROOT/scripts/rollback-xp-lot/03_voice_presence_consent_coordination.down.sql" "S3 retour 3 avant 4"
fi
refuses "$ROOT/scripts/rollback-xp-lot/01_separate_xp_balance.down.sql" "S3 retour 1 avec solde divergé"
echo "Résultat : $pass OK, $fail échec(s)"; [ "$fail" = 0 ]
