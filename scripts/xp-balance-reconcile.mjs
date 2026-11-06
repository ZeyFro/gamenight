// Recalage de CommunityMemberStats.xpBalance après la migration `separate_xp_balance` (filet de la décision D2).
//
//   XP_RECONCILE_DATABASE_URL=postgresql://… node scripts/xp-balance-reconcile.mjs [--since=<ISO>] [--include-mixed]
//   XP_RECONCILE_DATABASE_URL=postgresql://… node scripts/xp-balance-reconcile.mjs --execute --confirm-database=<base> [--since=<ISO>] [--include-mixed]
//
// Pourquoi : entre la migration (xpBalance = xpTotal) et le déploiement du nouveau code, l'ANCIEN code ne connaît que xpTotal :
// il crédite/débite xpTotal (gains, achats SHOP_PURCHASE, paris, pénalités, corrections admin, reset de saison) sans toucher xpBalance. (Décision A : le reset de saison conserve xpBalance ; le script refuse dans une communauté où une saison a démarré depuis la fenêtre.)
//
// Formule (la seule qui soit sans état, donc idempotente) : le nouveau code garde xpBalance = xpTotal sauf pour les achats de
// boutique, qui ne débitent QUE xpBalance (ledger XpEvent reason SHOP_BALANCE_PURCHASE, montant négatif). Donc :
//   cible = max(0, xpTotal + somme(SHOP_BALANCE_PURCHASE.amount depuis --since))
// Tout écart xpBalance <> cible vient d'un écrit de l'ancien code (ou d'un SQL manuel). xpTotal n'est JAMAIS modifié.
// Sans événement SHOP_BALANCE_PURCHASE, la formule revient à xpBalance = xpTotal ; elle ne vaut qu'avant la réouverture des écritures
// du nouveau code, ou pour les joueurs sans achat du nouveau code (« mixtes » ci-dessous).
//
// Sécurité :
// - dry-run par défaut (transaction READ ONLY) ; écriture seulement avec --execute ET --confirm-database=<base de la cible> ;
// - cible locale (127.0.0.1/localhost/::1, base ^gamenight_[a-z0-9_]+$) ou exactement XP_RECONCILE_ALLOW_REMOTE="<hôte>[:port]/<base>" ;
// - refuse si la migration separate_xp_balance n'est pas terminée, si une migration est inachevée, ou si --since est postérieur à sa fin ;
// - une seule transaction, lock_timeout 5 s, statement_timeout 30 s, lignes concernées verrouillées (FOR UPDATE, ordre stable),
//   contrôle final (aucun écart restant) avant COMMIT ; sinon ROLLBACK avec une erreur explicite ;
// - joueurs « mixtes » (au moins un achat du nouveau code depuis --since) : écarts listés « à arbitrer » mais NON écrits, car des
//   plafonds du nouveau code (pénalité d'absence, correction admin) peuvent légitimement séparer les deux compteurs ; --include-mixed les écrit ;
// - cible négative (le CHECK xpBalance >= 0 interdit) : écrit 0 et liste le joueur « à arbitrer » ;
// - aucune URL ni mot de passe n'est affiché. Sortie : 0 ok, 1 inattendu, 2 refusé, 4 contrôle ou concurrence en échec.
import { PrismaClient } from "@prisma/client";
import { EXIT, RefusalError, parseTarget, redact } from "./db-migrate-lib.mjs";

export const BALANCE_MIGRATION = "20261019190000_separate_xp_balance";
const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "30s";
const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };
const TOP = 10;
const LOCAL_DATABASE = /^gamenight_[a-z0-9_]+$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Arguments `--nom=valeur` et drapeaux ; tout le reste est refusé. */
export function readReconcileArgs(argv) {
  const args = { execute: false, confirm: undefined, since: undefined, includeMixed: false };
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !["execute", "confirm-database", "since", "include-mixed"].includes(match[1])) throw new RefusalError(`Argument inconnu : ${arg.split("=")[0]}`);
    const [, name, value] = match;
    if (["execute", "include-mixed"].includes(name)) {
      if (value !== undefined) throw new RefusalError(`--${name} est un drapeau sans valeur (reçu : ${arg})`);
      if (name === "execute") args.execute = true; else args.includeMixed = true;
    } else {
      if (!value) throw new RefusalError(`--${name}=<valeur> exige une valeur`);
      if (name === "since") args.since = value; else args.confirm = value;
    }
  }
  return args;
}

/** Instant ISO 8601 avec fuseau, ou refus. */
export function parseSince(value) {
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) throw new RefusalError("--since doit être un instant ISO 8601 avec fuseau (ex. 2026-11-06T14:40:22Z)");
  return new Date(value);
}

/** Cible locale (base gamenight_*) ou exactement celle de la variable d'opérateur. */
export function assertReconcileTarget(url, allowRemote) {
  if (!url) throw new RefusalError("XP_RECONCILE_DATABASE_URL est obligatoire");
  const target = parseTarget(url);
  if (target.local) {
    if (!LOCAL_DATABASE.test(target.database)) throw new RefusalError("Base locale refusée : le nom doit correspondre à ^gamenight_[a-z0-9_]+$");
    return target;
  }
  const expected = (allowRemote ?? "").toLowerCase().replace(/^\/+|\/+$/g, "");
  const [hostPort, ...rest] = expected.split("/");
  const [host, port] = hostPort.split(":");
  if (!expected || host !== target.host || (port && port !== target.port) || rest.join("/") !== target.database.toLowerCase()) {
    throw new RefusalError(`Cible non locale refusée (${target.host}:${target.port}/${target.database}) : définir XP_RECONCILE_ALLOW_REMOTE="<hôte>[:port]/<base>" identique à la cible`);
  }
  return target;
}

/** Cible d'une ligne : max(0, xpTotal + achats du nouveau code). `raw < 0` = le CHECK xpBalance >= 0 interdirait la valeur exacte. Pure. */
export function expectedBalance({ xpTotal, spent }) {
  const raw = xpTotal + spent;
  return { raw, target: Math.max(0, raw) };
}

/** Classe les lignes lues : écarts à écrire, à arbitrer (mixtes, négatifs) et statistiques. Pure. */
export function classifyRows(rows, { includeMixed = false } = {}) {
  const corrections = [];
  const mixedPending = [];
  const negatives = [];
  for (const row of rows) {
    const { raw, target } = expectedBalance(row);
    const delta = target - row.xpBalance;
    const mixed = row.purchases > 0;
    const entry = { communityId: row.communityId, userId: row.userId, xpTotal: row.xpTotal, xpBalance: row.xpBalance, spent: row.spent,
      purchases: row.purchases, target, delta, raw, mixed, noLedgerTrace: row.noLedgerTrace };
    if (raw < 0) negatives.push({ ...entry, written: delta !== 0 && (!mixed || includeMixed) });
    if (delta === 0) continue;
    if (mixed && !includeMixed) mixedPending.push(entry);
    else corrections.push(entry);
  }
  const byAmount = (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.userId.localeCompare(b.userId);
  corrections.sort(byAmount);
  return {
    corrections, mixedPending, negatives,
    raised: corrections.filter((c) => c.delta > 0).length, lowered: corrections.filter((c) => c.delta < 0).length,
    netDelta: corrections.reduce((sum, c) => sum + c.delta, 0),
    withoutTrace: corrections.filter((c) => c.noLedgerTrace).length,
  };
}

const ROWS_SQL = `
  SELECT s."communityId" AS community_id, s."userId" AS user_id, s."xpTotal"::bigint AS xp_total, s."xpBalance"::bigint AS xp_balance,
         coalesce(p.spent, 0)::bigint AS spent, coalesce(p.n, 0)::int AS purchases,
         (NOT EXISTS (SELECT 1 FROM "XpEvent" e WHERE e."communityId" = s."communityId" AND e."userId" = s."userId"
                        AND e."createdAt" >= $1::timestamptz AND e.reason::text <> 'SHOP_BALANCE_PURCHASE')
          AND NOT EXISTS (SELECT 1 FROM "XpBet" b WHERE b."voterId" = s."userId" AND (b."communityId" = s."communityId" OR b."communityId" IS NULL)
                        AND b."createdAt" >= $1::timestamptz)) AS no_ledger_trace
  FROM "CommunityMemberStats" s
  LEFT JOIN (SELECT "communityId", "userId", sum(amount) AS spent, count(*) AS n FROM "XpEvent"
             WHERE reason::text = 'SHOP_BALANCE_PURCHASE' AND "createdAt" >= $1::timestamptz GROUP BY "communityId", "userId") p
         ON p."communityId" = s."communityId" AND p."userId" = s."userId"
  ORDER BY s."communityId", s."userId"`;

async function readRows(tx, since) {
  const rows = await tx.$queryRawUnsafe(ROWS_SQL, since.toISOString());
  return rows.map((r) => ({
    communityId: r.community_id, userId: r.user_id, xpTotal: Number(r.xp_total), xpBalance: Number(r.xp_balance),
    spent: Number(r.spent), purchases: r.purchases, noLedgerTrace: r.no_ledger_trace,
  }));
}

/** Prérequis lus dans la transaction : refus explicite si le lot n'est pas appliqué. Renvoie la fin de la migration. */
async function checkPrerequisites(tx) {
  const migrations = await tx.$queryRawUnsafe(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`);
  const unfinished = migrations.filter((m) => !m.finished_at && !m.rolled_back_at).map((m) => m.migration_name);
  if (unfinished.length) throw new RefusalError(`Migration(s) inachevée(s) ou en échec : ${unfinished.join(", ")} (revue manuelle)`);
  const done = migrations.find((m) => m.migration_name === BALANCE_MIGRATION && m.finished_at && !m.rolled_back_at);
  if (!done) throw new RefusalError(`Migration ${BALANCE_MIGRATION} non appliquée : rien à recaler`);
  const [facts] = await tx.$queryRawUnsafe(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CommunityMemberStats' AND column_name = 'xpBalance') AS has_column,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMemberStats_xpBalance_nonnegative' AND contype = 'c' AND convalidated) AS has_check,
    EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'XpReason' AND e.enumlabel = 'SHOP_BALANCE_PURCHASE') AS has_enum`);
  if (!facts.has_column || !facts.has_check || !facts.has_enum) {
    throw new RefusalError("Lot incomplet : colonne xpBalance, contrainte CommunityMemberStats_xpBalance_nonnegative (validée) et valeur d'enum XpReason.SHOP_BALANCE_PURCHASE sont obligatoires");
  }
  return new Date(done.finished_at);
}

async function readActivity(tx, since) {
  const [events] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE reason::text = 'SHOP_PURCHASE')::int AS legacy_purchases,
    count(DISTINCT ("communityId", "userId"))::int AS users
    FROM "XpEvent" WHERE "createdAt" >= $1::timestamptz AND reason::text <> 'SHOP_BALANCE_PURCHASE'`, since.toISOString());
  const [bets] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS total FROM "XpBet" WHERE "createdAt" >= $1::timestamptz`, since.toISOString());
  return { events: events.total, legacyPurchases: events.legacy_purchases, eventUsers: events.users, bets: bets.total };
}

/**
 * Cœur du script, testable en process : renvoie { code, report }. `log` reçoit les lignes déjà masquées.
 * @param {string[]} argv
 * @param {{ XP_RECONCILE_DATABASE_URL?: string, XP_RECONCILE_ALLOW_REMOTE?: string }} env
 * @param {(line: string) => void} log
 */
export async function reconcile(argv, env, log) {
  const args = readReconcileArgs(argv);
  const url = env.XP_RECONCILE_DATABASE_URL;
  const target = assertReconcileTarget(url, env.XP_RECONCILE_ALLOW_REMOTE);
  const sinceArg = args.since ? parseSince(args.since) : undefined;
  if (args.execute && args.confirm !== target.database) {
    throw new RefusalError("--execute exige --confirm-database=<base de la cible> (absent ou différent) : aucune écriture");
  }
  if (!args.execute && args.confirm !== undefined) throw new RefusalError("--confirm-database n'a de sens qu'avec --execute");
  const say = (text) => log(redact(text, [url, target.password]));
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const report = await db.$transaction(async (tx) => {
      if (!args.execute) await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      const [current] = await tx.$queryRawUnsafe("SELECT current_database() AS name");
      if (current.name !== target.database) throw new RefusalError("La base connectée diffère de la cible de l'URL");
      const finishedAt = await checkPrerequisites(tx);
      if (sinceArg && sinceArg.getTime() > finishedAt.getTime()) {
        throw new RefusalError(`--since (${sinceArg.toISOString()}) est postérieur à la fin de ${BALANCE_MIGRATION} (${finishedAt.toISOString()}) : fenêtre incomplète, refus`);
      }
      const since = sinceArg ?? finishedAt;
      const rows = await readRows(tx, since);
      const activity = await readActivity(tx, since);
      const plan = classifyRows(rows, { includeMixed: args.includeMixed });
      // Décision A : un reset de saison remet xpTotal à 0 et CONSERVE xpBalance. Dès qu'une saison a démarré dans une communauté
      // concernée depuis la fenêtre (reset de l'ancien code ou du nouveau), xpBalance n'est plus déductible de xpTotal : la formule
      // abaisserait à tort le solde conservé. Refus (dry-run compris), arbitrage manuel de ces communautés.
      const impacted = [...new Set([...plan.corrections, ...plan.negatives, ...plan.mixedPending].map((entry) => entry.communityId))];
      if (impacted.length) {
        const seasons = await tx.$queryRawUnsafe(`SELECT DISTINCT "communityId" FROM "Season"
          WHERE "communityId" = ANY($1::text[]) AND "startDate" >= $2::timestamptz - interval '3 hours'`, impacted, since.toISOString());
        if (seasons.length) {
          throw new RefusalError(`Une saison a démarré depuis la fenêtre dans ${seasons.length} communauté(s) concernée(s) (${seasons.map((r) => r.communityId).slice(0, 5).join(", ")}) : le reset de saison conserve xpBalance (décision A), la formule ne s'applique plus. Aucune écriture : arbitrage manuel.`);
        }
      }
      let written = 0;
      if (args.execute && plan.corrections.length) {
        // Verrous explicites (ordre stable) sur les seules lignes à écrire, puis relecture sous verrou : un écrit concurrent
        // qui créerait un écart hors de ce jeu fait échouer (ROLLBACK) plutôt que d'être ignoré.
        const keys = plan.corrections.map((c) => [c.communityId, c.userId]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
        const locked = await tx.$queryRawUnsafe(`SELECT 1 FROM "CommunityMemberStats"
          WHERE ("communityId", "userId") IN (SELECT * FROM unnest($1::text[], $2::text[]))
          ORDER BY "communityId", "userId" FOR UPDATE`, keys.map((k) => k[0]), keys.map((k) => k[1]));
        if (locked.length !== keys.length) throw new ConcurrencyError("Des lignes à corriger ont disparu pendant le verrouillage : relancer");
        const lockedSet = new Set(keys.map((k) => `${k[0]}\u0000${k[1]}`));
        const fresh = classifyRows(await readRows(tx, since), { includeMixed: args.includeMixed });
        if (fresh.corrections.some((c) => !lockedSet.has(`${c.communityId}\u0000${c.userId}`))) {
          throw new ConcurrencyError("Des écritures concurrentes ont créé de nouveaux écarts pendant le recalage : couper les writers puis relancer");
        }
        written = await tx.$executeRawUnsafe(`UPDATE "CommunityMemberStats" s SET "xpBalance" = v.target
          FROM unnest($1::text[], $2::text[], $3::int[], $4::int[]) AS v(community_id, user_id, old_balance, target)
          WHERE s."communityId" = v.community_id AND s."userId" = v.user_id AND s."xpBalance" = v.old_balance`,
          fresh.corrections.map((c) => c.communityId), fresh.corrections.map((c) => c.userId),
          fresh.corrections.map((c) => c.xpBalance), fresh.corrections.map((c) => c.target));
        if (written !== fresh.corrections.length) throw new ConcurrencyError(`${written} ligne(s) écrite(s) sur ${fresh.corrections.length} attendue(s) : annulation`);
        const after = classifyRows(await readRows(tx, since), { includeMixed: args.includeMixed });
        if (after.corrections.length) throw new ConcurrencyError(`Contrôle final : ${after.corrections.length} écart(s) restant(s) après écriture : annulation`);
      }
      return { since, finishedAt, rows: rows.length, activity, plan, written };
    }, TX_OPTIONS);
    return { code: EXIT.OK, report: printReport(report, args, target, say), raw: report };
  } catch (error) {
    if (error instanceof ConcurrencyError) { say(`ECHEC ${error.message}`); return { code: EXIT.POSTCHECK_FAILED, report: null, raw: null }; }
    if (/lock timeout/i.test(String(error?.message))) {
      say(`ECHEC Verrou non obtenu en ${LOCK_TIMEOUT} : des écritures sont en cours sur CommunityMemberStats ; couper les writers puis relancer (rien n'a été écrit)`);
      return { code: EXIT.POSTCHECK_FAILED, report: null, raw: null };
    }
    throw error;
  } finally {
    await db.$disconnect();
  }

  function printReport(r, a, t, out) {
    const { plan, activity } = r;
    out(`Cible : ${t.host}:${t.port}/${t.database} (rôle ${t.username}), ${a.execute ? "EXÉCUTION" : "dry-run (lecture seule)"}`);
    out(`Migration ${BALANCE_MIGRATION} terminée le ${r.finishedAt.toISOString()} ; fenêtre depuis ${r.since.toISOString()} (${a.since ? "--since" : "fin de la migration"})`);
    out(`CommunityMemberStats : ${r.rows} ligne(s) ; ledger depuis la fenêtre (tous codes confondus) : ${activity.events} événement(s) hors achats-solde (dont ${activity.legacyPurchases} SHOP_PURCHASE) pour ${activity.eventUsers} couple(s), ${activity.bets} pari(s) posé(s)`);
    out(`Écarts à corriger : ${plan.corrections.length} (hausses ${plan.raised}, baisses ${plan.lowered}, somme nette ${plan.netDelta}) ; sans trace dans le ledger (reset de saison ou SQL manuel ?) : ${plan.withoutTrace}`);
    for (const c of plan.corrections.slice(0, TOP)) out(`  ${c.communityId} ${c.userId} : xpTotal ${c.xpTotal}, xpBalance ${c.xpBalance} -> ${c.target} (${c.delta > 0 ? "+" : ""}${c.delta})${c.mixed ? " [mixte]" : ""}`);
    if (plan.corrections.length > TOP) out(`  … ${plan.corrections.length - TOP} autre(s)`);
    for (const n of plan.negatives) out(`À ARBITRER solde exact négatif (${n.raw}) : ${n.communityId} ${n.userId} : xpTotal ${n.xpTotal}, achats nouveau code ${n.spent}, xpBalance ${n.xpBalance} -> ${n.target}${n.written ? " (0 écrit)" : n.delta === 0 ? " (déjà 0)" : " (non écrit)"}`);
    for (const m of plan.mixedPending) out(`À ARBITRER achats du nouveau code (${m.purchases}), non écrit sans --include-mixed : ${m.communityId} ${m.userId} : xpTotal ${m.xpTotal}, xpBalance ${m.xpBalance}, cible ${m.target} (${m.delta > 0 ? "+" : ""}${m.delta})`);
    if (a.execute) out(plan.corrections.length ? `RECALAGE APPLIQUÉ : ${r.written} ligne(s) écrite(s), contrôle final sans écart` : "AUCUNE CORRECTION : rien n'a été écrit");
    else out(plan.corrections.length ? `CORRECTIONS EN ATTENTE : ${plan.corrections.length} (dry-run : rien n'a été écrit ; relancer avec --execute --confirm-database=${t.database})` : "AUCUNE CORRECTION (dry-run : rien n'a été écrit)");
    return { ...plan, written: r.written, rows: r.rows, activity, since: r.since };
  }
}

class ConcurrencyError extends Error {}

if (process.argv[1]?.endsWith("xp-balance-reconcile.mjs")) {
  const secrets = () => {
    const url = process.env.XP_RECONCILE_DATABASE_URL;
    let password;
    try { password = parseTarget(url).password; } catch { /* URL illisible : seule l'URL brute est masquée */ }
    return [url, password];
  };
  reconcile(process.argv.slice(2), process.env, console.log).then(({ code }) => process.exit(code), (error) => {
    if (error instanceof RefusalError) { console.error(redact(`REFUSÉ : ${error.message}`, secrets())); process.exit(error.exitCode); }
    console.error(redact(`ERREUR INATTENDUE : ${error?.message ?? error}`, secrets()).slice(0, 600));
    process.exit(EXIT.UNEXPECTED);
  });
}
