import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "./test-local-database";
import {
  BALANCE_MIGRATION, assertReconcileTarget, classifyRows, expectedBalance, parseSince, readReconcileArgs, reconcile,
} from "../../scripts/xp-balance-reconcile.mjs";

// Recalage de xpBalance (scripts/xp-balance-reconcile.mjs) sur une base neuve `gamenight_xprec_*` du PostgreSQL de test
// (127.0.0.1 uniquement, migrations réelles appliquées par Prisma). Les écritures de « l'ancien code » après la migration
// sont simulées en SQL : elles modifient xpTotal (et le ledger) sans toucher xpBalance.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const NEW_DB = `gamenight_xprec_${Date.now()}`;
if (!TEST_DATABASE_URL) console.warn("[xp-balance-reconcile] TEST_DATABASE_URL absente : tests Postgres SKIPPÉS.");

describe("xp-balance-reconcile : arguments, cible et formule (sans base)", () => {
  it("refuse tout argument inconnu, drapeau avec valeur, valeur absente", () => {
    expect(readReconcileArgs([])).toEqual({ execute: false, confirm: undefined, since: undefined, includeMixed: false });
    expect(readReconcileArgs(["--execute", "--confirm-database=b", "--since=2026-11-06T14:40:22Z", "--include-mixed"]))
      .toMatchObject({ execute: true, confirm: "b", since: "2026-11-06T14:40:22Z", includeMixed: true });
    for (const bad of [["--write"], ["--execute=1"], ["--since="], ["--since", "x"], ["positional"]]) expect(() => readReconcileArgs(bad)).toThrow();
  });

  it("n'accepte qu'un instant ISO avec fuseau", () => {
    expect(parseSince("2026-11-06T14:40:22.668Z").toISOString()).toBe("2026-11-06T14:40:22.668Z");
    expect(parseSince("2026-11-06T16:40:22+02:00").toISOString()).toBe("2026-11-06T14:40:22.000Z");
    for (const bad of ["2026-11-06", "2026-11-06T14:40:22", "hier", "2026-13-45T00:00:00Z"]) expect(() => parseSince(bad)).toThrow(/ISO 8601/);
  });

  it("cible : local gamenight_* seulement, ou hôte distant strictement identique à la variable d'opérateur, sans fuite du mot de passe", () => {
    const local = (db: string) => `${"postgresql:"}//u:p@127.0.0.1:55439/${db}`;
    expect(() => assertReconcileTarget(local("gamenight_test"), undefined)).not.toThrow();
    expect(() => assertReconcileTarget(local("production"), undefined)).toThrow(/gamenight_/);
    expect(() => assertReconcileTarget("", undefined)).toThrow(/obligatoire/);
    const remote = `${"postgresql:"}//u:pw-secret@db.example.invalid:5432/appdb`;
    expect(() => assertReconcileTarget(remote, undefined)).toThrow(/XP_RECONCILE_ALLOW_REMOTE/);
    expect(() => assertReconcileTarget(remote, "db.example.invalid:5432/autre")).toThrow(/refusée/);
    expect(() => assertReconcileTarget(remote, "db.example.invalid:5432/appdb")).not.toThrow();
    try { assertReconcileTarget(remote, undefined); } catch (error) { expect(String((error as Error).message)).not.toContain("pw-secret"); }
  });

  it("formule : max(0, xpTotal + achats du nouveau code) ; classement des écarts, mixtes et négatifs", () => {
    expect(expectedBalance({ xpTotal: 350, spent: 0 })).toEqual({ raw: 350, target: 350 });
    expect(expectedBalance({ xpTotal: 350, spent: -250 })).toEqual({ raw: 100, target: 100 });
    expect(expectedBalance({ xpTotal: 100, spent: -300 })).toEqual({ raw: -200, target: 0 });
    const row = (over: object) => ({ communityId: "c", userId: "u", xpTotal: 100, xpBalance: 100, spent: 0, purchases: 0, noLedgerTrace: false, ...over });
    const plan = classifyRows([
      row({ userId: "ok" }), row({ userId: "up", xpTotal: 300 }), row({ userId: "down", xpTotal: 40 }),
      row({ userId: "neg", xpTotal: -5, xpBalance: 10 }),
      row({ userId: "mixed", xpBalance: 80, spent: -10, purchases: 1 }), row({ userId: "mixedneg", xpBalance: 50, spent: -300, purchases: 1 }),
    ]);
    expect(plan.corrections.map((c: { userId: string; target: number }) => [c.userId, c.target])).toEqual([["up", 300], ["down", 40], ["neg", 0]]);
    expect(plan.mixedPending.map((c: { userId: string }) => c.userId).sort()).toEqual(["mixed", "mixedneg"]);
    expect(plan.negatives.map((c: { userId: string }) => c.userId).sort()).toEqual(["mixedneg", "neg"]);
    expect(classifyRows([row({ userId: "mixedneg", xpBalance: 50, spent: -300, purchases: 1 })], { includeMixed: true }).corrections).toHaveLength(1);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("xp-balance-reconcile : base neuve avec les migrations réelles", () => {
  let admin: PrismaClient;
  let db: PrismaClient;
  let communityId: string;
  const urlFor = (database: string) => { const u = new URL(TEST_DATABASE_URL!); u.pathname = `/${database}`; return u.toString(); };
  const url = () => urlFor(NEW_DB);
  const env = () => ({ XP_RECONCILE_DATABASE_URL: url() });
  const run = async (argv: string[] = []) => { const lines: string[] = []; const result = await reconcile(argv, env(), (line: string) => lines.push(line)); return { ...result, text: lines.join("\n") }; };
  const cli = (argv: string[], extra: Record<string, string> = {}) => {
    const clean: NodeJS.ProcessEnv = { ...process.env }; delete clean.DATABASE_URL; delete clean.XP_RECONCILE_DATABASE_URL; delete clean.XP_RECONCILE_ALLOW_REMOTE;
    return spawnSync(process.execPath, [resolve("scripts/xp-balance-reconcile.mjs"), ...argv], { env: { ...clean, ...extra }, encoding: "utf8" });
  };
  const confirm = () => `--confirm-database=${NEW_DB}`;

  const stats = async () => Object.fromEntries((await db.communityMemberStats.findMany()).map((s) => [s.userId, { xpTotal: s.xpTotal, xpBalance: s.xpBalance }]));
  const snapshot = async () => JSON.stringify([await db.communityMemberStats.findMany({ orderBy: { userId: "asc" } }), await db.xpEvent.count()]);
  let seq = 0;
  /** Joueur créé « juste après la migration » : xpBalance = xpTotal. */
  const member = async (name: string, xp: number) => {
    const user = await db.user.create({ data: { id: name, discordId: `rec-${name}`, discordName: name } });
    await db.membership.create({ data: { communityId, userId: user.id, status: "ACTIVE" } });
    await db.communityMemberStats.create({ data: { communityId, userId: user.id, xpTotal: xp, xpBalance: xp } });
    return user.id;
  };
  /** Écriture de l'ANCIEN code : xpTotal et ledger, jamais xpBalance. */
  const oldCode = async (userId: string, reason: "VOTE" | "SHOP_PURCHASE", amount: number) => {
    await db.xpEvent.create({ data: { communityId, userId, reason, sourceId: `old-${++seq}`, amount } });
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpTotal: { increment: amount } } });
  };
  /** Écriture du NOUVEAU code : achat boutique, xpBalance seul. */
  const newPurchase = async (userId: string, price: number) => {
    await db.xpEvent.create({ data: { communityId, userId, reason: "SHOP_BALANCE_PURCHASE", sourceId: `item-${++seq}`, amount: -price } });
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpBalance: { decrement: price } } });
  };

  beforeAll(async () => {
    assertLocalTestDatabase(TEST_DATABASE_URL); // avant tout client et toute requête
    admin = new PrismaClient({ datasourceUrl: urlFor("postgres") });
    for (const { datname } of await admin.$queryRawUnsafe<{ datname: string }[]>(`SELECT datname FROM pg_database WHERE datname LIKE 'gamenight\\_xprec\\_%'`)) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE "${NEW_DB}"`);
    const migrate = spawnSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url() }, encoding: "utf8" });
    expect(migrate.status, migrate.stdout + migrate.stderr).toBe(0);
    db = new PrismaClient({ datasourceUrl: url() });
  }, 120_000);
  afterAll(async () => {
    await db?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NEW_DB}" WITH (FORCE)`);
    await admin?.$disconnect();
  }, 60_000);
  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "XpBet", "XpEvent", "CommunityMemberStats", "Membership", "User", "Community" CASCADE`);
    communityId = (await db.community.create({ data: { slug: "rec", name: "Rec", status: "ACTIVE" } })).id;
  });

  it("recale gains, ancien achat SHOP_PURCHASE, pari, ligne créée sans solde et xpTotal ramené à 0 hors saison ; xpTotal et ledger intacts", async () => {
    await member("gain", 500); await oldCode("gain", "VOTE", 100); await oldCode("gain", "SHOP_PURCHASE", -250);     // 500 +100 -250 = 350
    await member("bet", 800);
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId: "bet" } }, data: { xpTotal: { decrement: 100 } } });
    const session = await db.session.create({ data: { communityId, createdById: "bet", date: new Date(), status: "SCHEDULED" } });
    await db.xpBet.create({ data: { communityId, sessionId: session.id, voterId: "bet", targetUserId: "bet", amount: 100 } });           // pari de l'ancien code : aucun XpEvent
    await db.user.create({ data: { id: "fresh", discordId: "rec-fresh", discordName: "fresh" } });
    await db.communityMemberStats.create({ data: { communityId, userId: "fresh", xpTotal: 0, xpBalance: 0 } }); // ligne née de l'ancien code
    await oldCode("fresh", "VOTE", 50);
    await member("season", 300);
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId: "season" } }, data: { xpTotal: 0 } }); // xpTotal ramené à 0 hors saison (SQL manuel) : aucune Season récente, donc recalable
    await member("quiet", 70);
    const totalsBefore = Object.fromEntries(Object.entries(await stats()).map(([k, v]) => [k, v.xpTotal]));
    const eventsBefore = await db.xpEvent.count();

    const dry = await run();
    expect(dry.code).toBe(0);
    expect(dry.report.corrections.map((c: { userId: string; target: number }) => [c.userId, c.target]).sort()).toEqual([["bet", 700], ["fresh", 50], ["gain", 350], ["season", 0]]);
    expect(dry.report.withoutTrace).toBe(1);
    expect(dry.text).toContain("dry-run (lecture seule)");
    expect(dry.text).toContain("CORRECTIONS EN ATTENTE : 4");
    expect(dry.text).not.toContain(url());

    await expect(run(["--execute"])).rejects.toThrow(/--confirm-database/);
    await expect(run(["--execute", "--confirm-database=autre_base"])).rejects.toThrow(/--confirm-database/);
    expect(JSON.stringify(await stats())).toContain('"gain":{"xpTotal":350,"xpBalance":500}'); // dry-run et refus : rien d'écrit

    const exec = await run(["--execute", confirm()]);
    expect(exec.code).toBe(0);
    expect(exec.report.written).toBe(4);
    expect(exec.text).toContain("RECALAGE APPLIQUÉ : 4 ligne(s)");
    expect(await stats()).toEqual({ gain: { xpTotal: 350, xpBalance: 350 }, bet: { xpTotal: 700, xpBalance: 700 }, fresh: { xpTotal: 50, xpBalance: 50 },
      season: { xpTotal: 0, xpBalance: 0 }, quiet: { xpTotal: 70, xpBalance: 70 } });
    expect(Object.fromEntries(Object.entries(await stats()).map(([k, v]) => [k, v.xpTotal]))).toEqual({ ...totalsBefore });
    expect(await db.xpEvent.count()).toBe(eventsBefore);
  });

  it("décision A : une saison démarrée depuis la fenêtre dans une communauté concernée fait refuser le recalage (dry-run et exécution), rien d'écrit", async () => {
    await member("gain", 500); await oldCode("gain", "VOTE", 100);          // écart à corriger : solde 500, cible 600
    // Reset de saison : xpTotal à 0, xpBalance CONSERVÉ (le solde n'est plus déductible de xpTotal).
    await member("reset", 300);
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId: "reset" } }, data: { xpTotal: 0 } });
    await db.season.create({ data: { communityId, number: 2, name: "Saison 2", startDate: new Date(), endDate: new Date(Date.now() + 30 * 86_400_000), isActive: true } });
    const before = await snapshot();

    await expect(run()).rejects.toThrow(/saison a démarré depuis la fenêtre.*conserve xpBalance/);
    await expect(run(["--execute", confirm()])).rejects.toThrow(/saison a démarré depuis la fenêtre/);
    expect(await snapshot()).toBe(before);
  });

  it("une saison démarrée avant la fenêtre, ou dans une autre communauté, ne bloque pas le recalage", async () => {
    await member("gain", 500); await oldCode("gain", "VOTE", 100);
    await db.season.create({ data: { communityId, number: 1, name: "Saison 1", startDate: new Date("2020-01-01T00:00:00Z"), endDate: new Date("2020-02-01T00:00:00Z"), isActive: false } });
    const other = await db.community.create({ data: { slug: "rec-other", name: "Autre", status: "ACTIVE" } });
    await db.season.create({ data: { communityId: other.id, number: 2, name: "Saison 2", startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), isActive: true } });
    const dry = await run();
    expect(dry.code).toBe(0);
    expect(dry.report.corrections.map((c: { userId: string; target: number }) => [c.userId, c.target])).toEqual([["gain", 600]]);
  });

  it("idempotent : un second passage (dry-run puis exécution) ne change rien", async () => {
    await member("a", 400); await oldCode("a", "VOTE", 60); await oldCode("a", "SHOP_PURCHASE", -200);
    expect((await run(["--execute", confirm()])).report.written).toBe(1);
    const after = await snapshot();
    const dry = await run();
    expect(dry.report.corrections).toEqual([]);
    expect(dry.text).toContain("AUCUNE CORRECTION");
    const again = await run(["--execute", confirm()]);
    expect(again.report.written).toBe(0);
    expect(again.text).toContain("AUCUNE CORRECTION : rien n'a été écrit");
    expect(await snapshot()).toBe(after);
    expect((await stats()).a).toEqual({ xpTotal: 260, xpBalance: 260 });
  });

  it("achat du nouveau code déjà fait : le solde garde la dépense, un joueur « mixte » est listé sans être écrit", async () => {
    await member("buyer", 1000); await newPurchase("buyer", 300);          // 1000 / 700 : état sain du nouveau code
    await member("both", 1000); await newPurchase("both", 300); await oldCode("both", "VOTE", 50); // dérive de 50 sur un joueur qui a aussi acheté
    const dry = await run();
    expect(dry.report.corrections).toEqual([]);
    expect(dry.report.mixedPending.map((m: { userId: string; target: number; delta: number }) => [m.userId, m.target, m.delta])).toEqual([["both", 750, 50]]);
    expect(dry.text).toContain("À ARBITRER achats du nouveau code");
    expect((await run(["--execute", confirm()])).report.written).toBe(0);
    expect((await stats()).both.xpBalance).toBe(700);
    const forced = await run(["--execute", confirm(), "--include-mixed"]);
    expect(forced.report.written).toBe(1);
    expect(await stats()).toEqual({ buyer: { xpTotal: 1000, xpBalance: 700 }, both: { xpTotal: 1050, xpBalance: 750 } });
    expect((await run(["--include-mixed"])).report.corrections).toEqual([]);
  });

  it("cible exacte négative : écrit 0 (le CHECK n'est jamais violé) et liste le joueur à arbitrer", async () => {
    await member("neg", 100); await newPurchase("neg", 50);                  // 100 / 50
    await db.xpEvent.create({ data: { communityId, userId: "neg", reason: "SHOP_BALANCE_PURCHASE", sourceId: "gros", amount: -250 } }); // ledger : -300 au total, xpTotal 100
    const hold = await run();
    expect(hold.report.corrections).toEqual([]);
    expect(hold.report.negatives).toHaveLength(1);
    expect(hold.text).toContain("À ARBITRER solde exact négatif (-200)");
    expect(hold.text).toContain("non écrit");
    const forced = await run(["--execute", confirm(), "--include-mixed"]);
    expect(forced.report.written).toBe(1);
    expect(forced.text).toContain("(0 écrit)");
    expect((await stats()).neg).toEqual({ xpTotal: 100, xpBalance: 0 });
    const second = await run(["--include-mixed"]);
    expect(second.report.corrections).toEqual([]);
    expect(second.text).toContain("(déjà 0)");
  });

  it("refuse sans migration terminée, avec une migration inachevée, ou avec --since postérieur à la fin de la migration", async () => {
    await member("p", 10); await oldCode("p", "VOTE", 5);
    const [row] = await db.$queryRawUnsafe<{ finished_at: Date }[]>(`SELECT finished_at FROM _prisma_migrations WHERE migration_name = $1`, BALANCE_MIGRATION);
    const later = new Date(row.finished_at.getTime() + 60_000).toISOString();
    await expect(run([`--since=${later}`])).rejects.toThrow(/postérieur/);
    expect((await run([`--since=${new Date(row.finished_at.getTime() - 3_600_000).toISOString()}`])).report.corrections).toHaveLength(1);
    try {
      await db.$executeRawUnsafe(`UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = $1`, BALANCE_MIGRATION);
      await expect(run()).rejects.toThrow(/inachevée/);
      await db.$executeRawUnsafe(`UPDATE _prisma_migrations SET finished_at = $2::timestamptz, rolled_back_at = now() WHERE migration_name = $1`, BALANCE_MIGRATION, row.finished_at.toISOString());
      await expect(run()).rejects.toThrow(/non appliquée/);
    } finally {
      await db.$executeRawUnsafe(`UPDATE _prisma_migrations SET finished_at = $2::timestamptz, rolled_back_at = NULL WHERE migration_name = $1`, BALANCE_MIGRATION, row.finished_at.toISOString());
    }
    expect((await run()).report.corrections).toHaveLength(1);
    expect((await stats()).p).toEqual({ xpTotal: 15, xpBalance: 10 }); // aucun de ces refus n'a écrit
  });

  it("verrou externe sur une ligne à corriger : échec explicite au bout de 5 s, rien d'écrit, puis succès une fois le verrou levé", async () => {
    await member("locked", 100); await oldCode("locked", "VOTE", 40);
    const holder = new PrismaClient({ datasourceUrl: url() });
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let held!: () => void;
    const acquired = new Promise<void>((done) => { held = done; });
    const session = holder.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM "CommunityMemberStats" WHERE "userId" = 'locked' FOR UPDATE`);
      held();
      await gate;
    }, { timeout: 60_000 });
    await acquired;
    try {
      const started = Date.now();
      const blocked = await run(["--execute", confirm()]);
      expect(blocked.code).toBe(4);
      expect(blocked.text).toContain("Verrou non obtenu en 5s");
      expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
    } finally {
      release();
      await session;
      await holder.$disconnect();
    }
    expect((await stats()).locked).toEqual({ xpTotal: 140, xpBalance: 100 });
    expect((await run(["--execute", confirm()])).report.written).toBe(1);
    expect((await stats()).locked).toEqual({ xpTotal: 140, xpBalance: 140 });
  }, 60_000);

  it("CLI : codes de sortie 2 sans fuite de secret (sans URL, hôte distant, --execute sans confirmation, argument inconnu) et 0 en dry-run", async () => {
    await member("c", 10); await oldCode("c", "VOTE", 5);
    expect(cli([]).status).toBe(2);
    const remote = cli([], { XP_RECONCILE_DATABASE_URL: `${"postgresql:"}//u:pw-secret@db.example.invalid:5432/appdb` });
    expect(remote.status).toBe(2);
    expect(remote.stdout + remote.stderr).not.toContain("pw-secret");
    const noConfirm = cli(["--execute"], { XP_RECONCILE_DATABASE_URL: url() });
    expect(noConfirm.status).toBe(2);
    expect(noConfirm.stderr).toContain("--confirm-database");
    expect(cli(["--force"], { XP_RECONCILE_DATABASE_URL: url() }).status).toBe(2);
    const dry = cli([], { XP_RECONCILE_DATABASE_URL: url() });
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.stdout).toContain("CORRECTIONS EN ATTENTE : 1");
    expect(dry.stdout + dry.stderr).not.toContain("postgresql://");
    expect((await stats()).c).toEqual({ xpTotal: 15, xpBalance: 10 });
  });

  it("le CHECK xpBalance >= 0 de la base interdit toute valeur négative, même hors script", async () => {
    await member("check", 10);
    await expect(db.$executeRawUnsafe(`UPDATE "CommunityMemberStats" SET "xpBalance" = -1 WHERE "userId" = 'check'`)).rejects.toThrow(/xpBalance_nonnegative/);
    expect((await stats()).check).toEqual({ xpTotal: 10, xpBalance: 10 });
  });
});
