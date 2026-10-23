// Contrôle d'invariants du lot XP + vocal (6 migrations), en LECTURE SEULE (transaction READ ONLY, SELECT uniquement).
//
//   XP_INVARIANTS_DATABASE_URL=postgresql://… node scripts/xp-lot-invariants.mjs --phase=before|after|reopened [--expect-fingerprint=<md5>]
//
// before   : avant le lot : les 6 migrations manquent, aucun objet du lot, progression non négative (prérequis de la contrainte).
// after    : juste après le lot, écritures encore bloquées : 6 terminées, objets présents, xpBalance = xpTotal partout, aucun négatif.
// reopened : après réouverture des écritures : mêmes contrôles, sauf l'égalité xpBalance = xpTotal (elle diverge légitimement après un achat).
// --expect-fingerprint : empreinte (progression + équipements + objets) relevée en `before`; doit être identique en `after`.
// Cible : 127.0.0.1 / localhost / ::1 par défaut. Hors machine locale, refus sauf XP_INVARIANTS_ALLOW_REMOTE="<hôte>[:port]/<base>"
// égal à la cible (variable d'opérateur). Aucune URL ni mot de passe n'est affiché. Sortie : 0 ok, 2 refusé, 4 invariant en échec, 1 inattendu.
import { PrismaClient } from "@prisma/client";
import { RefusalError, parseTarget, redact } from "./db-migrate-lib.mjs";

export const LOT_MIGRATIONS = [
  "20261019190000_separate_xp_balance",
  "20261020150000_session_voice_presence",
  "20261022120000_voice_presence_consent_coordination",
  "20261022130000_voice_presence_retention_gap_bounds",
  "20261022140000_voice_presence_gap_history",
  "20261022142500_shop_balance_purchase_reason",
];
const TABLES = ["SessionVoicePresenceInterval", "SessionVoicePresenceConsent", "SessionVoicePresenceControl", "SessionVoicePresenceGap"];
const COLUMNS = [["CommunityMemberStats", "xpBalance"], ["SessionVoicePresenceInterval", "consentId"], ["SessionVoicePresenceInterval", "endedAt"],
  ["SessionVoicePresenceInterval", "expiresAt"], ["SessionVoicePresenceControl", "gapStartedAt"]];

/** Décide de la cible : locale, ou exactement celle de la variable d'opérateur. */
export function assertReadTarget(url, allowRemote) {
  if (!url) throw new RefusalError("XP_INVARIANTS_DATABASE_URL est obligatoire");
  const target = parseTarget(url);
  if (!target.local) {
    const expected = (allowRemote ?? "").toLowerCase().replace(/^\/+|\/+$/g, "");
    const [hostPort, ...rest] = expected.split("/");
    const [host, port] = hostPort.split(":");
    if (!expected || host !== target.host || (port && port !== target.port) || rest.join("/") !== target.database.toLowerCase()) {
      throw new RefusalError(`Cible non locale refusée (${target.host}:${target.port}/${target.database}) : définir XP_INVARIANTS_ALLOW_REMOTE="<hôte>[:port]/<base>" identique à la cible`);
    }
  }
  return target;
}

/** Évalue les relevés contre la phase; renvoie la liste des échecs (vide = ok). Pure, testée sans base. */
export function evaluate(phase, f, expectFingerprint) {
  const fails = [];
  const after = phase !== "before";
  for (const name of LOT_MIGRATIONS) {
    const state = f.migrations[name] ?? "absente";
    if (after && state !== "terminée") fails.push(`migration ${name} : ${state} (attendu : terminée)`);
    if (!after && state !== "absente") fails.push(`migration ${name} : ${state} (attendu : absente avant le lot)`);
  }
  if (f.unfinished.length) fails.push(`migration(s) inachevée(s) ou en échec : ${f.unfinished.join(", ")}`);
  for (const [object, present] of Object.entries(f.objects)) {
    if (present !== after) fails.push(`objet ${object} : ${present ? "présent" : "absent"} (attendu : ${after ? "présent" : "absent"})`);
  }
  if (f.negativeXpTotal > 0) fails.push(`${f.negativeXpTotal} ligne(s) avec xpTotal < 0`);
  if (after) {
    if (f.negativeXpBalance > 0) fails.push(`${f.negativeXpBalance} ligne(s) avec xpBalance < 0`);
    if (phase === "after" && f.balanceDiffersFromTotal > 0) fails.push(`${f.balanceDiffersFromTotal} ligne(s) avec xpBalance <> xpTotal`);
  }
  if (expectFingerprint && f.fingerprint !== expectFingerprint) fails.push(`empreinte ${f.fingerprint} <> attendue ${expectFingerprint}`);
  return fails;
}

async function collect(tx) {
  const one = async (sql, ...values) => (await tx.$queryRawUnsafe(sql, ...values))[0];
  const rows = await tx.$queryRawUnsafe(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`);
  const migrations = {};
  const unfinished = [];
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at) unfinished.push(row.migration_name);
    else if (LOT_MIGRATIONS.includes(row.migration_name)) migrations[row.migration_name] = "terminée";
  }
  for (const row of rows) if (row.rolled_back_at && LOT_MIGRATIONS.includes(row.migration_name) && !migrations[row.migration_name]) migrations[row.migration_name] = "annulée";
  const objects = {};
  for (const table of TABLES) objects[`table ${table}`] = (await one(`SELECT to_regclass($1) IS NOT NULL AS present`, `public."${table}"`)).present;
  for (const [table, column] of COLUMNS) {
    objects[`colonne ${table}.${column}`] = (await one(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS present`, table, column)).present;
  }
  objects["contrainte CommunityMemberStats_xpBalance_nonnegative (validée)"] = (await one(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMemberStats_xpBalance_nonnegative' AND contype = 'c' AND convalidated) AS present`)).present;
  objects["valeur d'enum XpReason.SHOP_BALANCE_PURCHASE"] = (await one(
    `SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'XpReason' AND e.enumlabel = 'SHOP_BALANCE_PURCHASE') AS present`)).present;
  objects["type SessionVoicePresenceControlStatus"] = (await one(`SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SessionVoicePresenceControlStatus') AS present`)).present;
  const hasBalance = objects["colonne CommunityMemberStats.xpBalance"];
  const stats = await one(`SELECT count(*)::int AS members, coalesce(sum("xpTotal"), 0)::bigint AS xp_sum, count(*) FILTER (WHERE "xpTotal" < 0)::int AS negative_total FROM "CommunityMemberStats"`);
  const balance = hasBalance
    ? await one(`SELECT count(*) FILTER (WHERE "xpBalance" < 0)::int AS negative_balance, count(*) FILTER (WHERE "xpBalance" <> "xpTotal")::int AS differs FROM "CommunityMemberStats"`)
    : { negative_balance: 0, differs: 0 };
  const events = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE reason::text = 'SHOP_PURCHASE')::int AS legacy_purchases,
    count(*) FILTER (WHERE reason::text = 'SHOP_BALANCE_PURCHASE')::int AS balance_purchases FROM "XpEvent"`);
  const cosmetics = await one(`SELECT count(*)::int AS owned FROM "CommunityMemberCosmetic"`);
  // L'empreinte exclut xpBalance : identique avant/après tant que progression, équipements et objets sont inchangés.
  const fingerprint = (await one(`SELECT md5(
      coalesce((SELECT string_agg(concat_ws('|', "communityId", "userId", "xpTotal", "equippedTitleId", "equippedFrameId", "equippedColorId"), E'\\n' ORDER BY "communityId", "userId") FROM "CommunityMemberStats"), '') ||
      '#' || coalesce((SELECT string_agg(concat_ws('|', "communityId", "userId", "itemId"), E'\\n' ORDER BY "communityId", "userId", "itemId") FROM "CommunityMemberCosmetic"), '')) AS hash`)).hash;
  return { migrations, unfinished, objects, members: stats.members, xpSum: String(stats.xp_sum), negativeXpTotal: stats.negative_total,
    negativeXpBalance: balance.negative_balance, balanceDiffersFromTotal: balance.differs, events, ownedCosmetics: cosmetics.owned, fingerprint };
}

async function main() {
  const phase = /^--phase=(before|after|reopened)$/.exec(process.argv.find((arg) => arg.startsWith("--phase=")) ?? "")?.[1];
  if (!phase) throw new RefusalError("--phase=before|after|reopened obligatoire");
  const unknown = process.argv.slice(2).find((arg) => !/^--(phase|expect-fingerprint)=/.test(arg));
  if (unknown) throw new RefusalError(`Argument inconnu : ${unknown.split("=")[0]}`);
  const expectFingerprint = process.argv.find((arg) => arg.startsWith("--expect-fingerprint="))?.slice("--expect-fingerprint=".length);
  const url = process.env.XP_INVARIANTS_DATABASE_URL;
  const target = assertReadTarget(url, process.env.XP_INVARIANTS_ALLOW_REMOTE);
  const secrets = [url, target.password];
  const say = (text) => console.log(redact(text, secrets));
  say(`Cible : ${target.host}:${target.port}/${target.database} (rôle ${target.username}), phase ${phase}, lecture seule`);
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const facts = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [readOnly] = await tx.$queryRawUnsafe("SHOW transaction_read_only");
      if (readOnly.transaction_read_only !== "on") throw new Error("transaction non READ ONLY : abandon");
      return collect(tx);
    }, { timeout: 60_000 });
    for (const name of LOT_MIGRATIONS) say(`migration ${name} : ${facts.migrations[name] ?? "absente"}`);
    for (const [object, present] of Object.entries(facts.objects)) say(`${present ? "présent " : "absent  "} ${object}`);
    say(`CommunityMemberStats : ${facts.members} ligne(s), somme xpTotal ${facts.xpSum}, xpTotal<0 : ${facts.negativeXpTotal}, xpBalance<0 : ${facts.negativeXpBalance}, xpBalance<>xpTotal : ${facts.balanceDiffersFromTotal}`);
    say(`XpEvent : ${facts.events.total} (SHOP_PURCHASE ${facts.events.legacy_purchases}, SHOP_BALANCE_PURCHASE ${facts.events.balance_purchases}), objets possédés : ${facts.ownedCosmetics}`);
    say(`EMPREINTE ${facts.fingerprint}`);
    const fails = evaluate(phase, facts, expectFingerprint);
    for (const fail of fails) say(`ECHEC ${fail}`);
    say(fails.length ? `INVARIANTS EN ÉCHEC (${fails.length})` : `INVARIANTS OK (phase ${phase})`);
    return fails.length ? 4 : 0;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("xp-lot-invariants.mjs")) {
  main().then((code) => process.exit(code), (error) => {
    if (error instanceof RefusalError) { console.error(`REFUSÉ : ${error.message}`); process.exit(error.exitCode); }
    console.error(`ERREUR INATTENDUE : ${error?.message ?? error}`.slice(0, 600));
    process.exit(1);
  });
}
