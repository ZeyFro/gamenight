// Répétition de la bascule xpBalance sur des COPIES locales jetables (jamais Neon, jamais Production).
// Prérequis : conteneur postgres:16-alpine lié à 127.0.0.1:55471 (XP_BASCULE_CONTAINER / XP_BASCULE_PORT).
// Usage : node scripts/rehearse-xp-balance-bascule.mjs
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRunner, assertLocalTarget, run } from "./xp-balance-bascule.mjs";
import { EXPECTED_ROLLOUT_MIGRATIONS } from "./xp-rollout-migration-gate.mjs";

const env = { ...process.env };
const container = env.XP_BASCULE_CONTAINER ?? "gamenight-xp-bascule-pg";
const port = env.XP_BASCULE_PORT ?? "55471";
const target = assertLocalTarget({ container, port, database: "gamenight_xp_rehearsal" });
const runner = createRunner(target, env);
const stamp = Date.now();
const created = [];

// Schéma de départ : les migrations du checkout SAUF les migrations du lot (XP + vocal).
const work = mkdtempSync(join(tmpdir(), "xp-baseline-"));
cpSync(resolve("prisma"), join(work, "prisma"), { recursive: true });
for (const name of EXPECTED_ROLLOUT_MIGRATIONS) rmSync(join(work, "prisma", "migrations", name), { recursive: true });
const baselineSchema = join(work, "prisma", "schema.prisma");

function freshDatabase(label) {
  const name = `gamenight_xp_${label}_${stamp}`;
  runner.docker(["exec", target.container, "createdb", "-U", "postgres", name]);
  created.push(name);
  const result = runner.migrate(name, baselineSchema);
  assert.equal(result.status, 0, result.output);
  return name;
}

function seed(database, users) {
  runner.sql(database, `
    INSERT INTO "User" ("id", "discordId", "discordName")
      SELECT 'u' || g, 'discord-' || g, 'Joueur ' || g FROM generate_series(1, ${users}) g;
    -- 3 communautés, progression 0..~6000 plus bornes de niveaux/grades et maximum Int.
    INSERT INTO "CommunityMemberStats" ("communityId", "userId", "xpTotal", "streakCount", "bestStreakCount", "tournamentsParticipatedCount")
      SELECT 'comm-' || (g % 3), 'u' || g,
             CASE WHEN g <= 9 THEN (ARRAY[0,49,50,799,800,4049,4050,10000000,2147483647])[g] ELSE (g * 37) % 6000 END,
             g % 9, g % 14, g % 5
      FROM generate_series(1, ${users}) g;
    INSERT INTO "CommunityMemberStats" ("communityId", "userId", "xpTotal")
      SELECT 'comm-other', 'u' || g, (g * 11) % 900 FROM generate_series(1, ${Math.floor(users / 10)}) g;
    INSERT INTO "CommunityMemberCosmetic" ("communityId", "userId", "itemId")
      SELECT 'comm-' || (g % 3), 'u' || g, 'title-strategist' FROM generate_series(10, ${Math.floor(users / 4)}) g;
    UPDATE "CommunityMemberStats" SET "equippedTitleId" = 'title-strategist'
      WHERE ("communityId", "userId") IN (SELECT "communityId", "userId" FROM "CommunityMemberCosmetic");
    -- Ledger : gains, achats historiques (SHOP_PURCHASE) et corrections.
    INSERT INTO "XpEvent" ("communityId", "id", "userId", "reason", "sourceId", "amount")
      SELECT 'comm-' || (g % 3), 'ev' || g, 'u' || (g % ${users} + 1), (ARRAY['SESSION_ATTENDANCE','SHOP_PURCHASE','VOTE'])[g % 3 + 1]::"XpReason", 'src-' || g,
             CASE WHEN g % 3 = 1 THEN -50 ELSE 25 END
      FROM generate_series(1, ${users * 3}) g;`);
}

const proof = { port, steps: [] };
const step = (name, value) => { proof.steps.push({ name, ...value }); console.log(`OK ${name}`); };
try {
  // A. Garde-fous de cible
  assert.throws(() => assertLocalTarget({ container, port, database: "neondb" }), /Base refusée/);
  assert.throws(() => assertLocalTarget({ container: "neon-prod", port, database: "gamenight_xp_x" }), /Neon/);
  assert.throws(() => run([], { ...env, XP_BASCULE_DATABASE: "postgres" }), /Base refusée/);
  assert.throws(() => run([], { ...env, XP_BASCULE_PORT: "55439", XP_BASCULE_DATABASE: "gamenight_xp_x" }));
  step("garde-fous cible (base non gamenight_xp_*, nom Neon, mauvais port)", {});

  // B. Copie nominale
  const main = freshDatabase("copie");
  seed(main, 2000);
  const counts = runner.sql(main, `SELECT (SELECT count(*) FROM "CommunityMemberStats"), (SELECT count(*) FROM "CommunityMemberCosmetic"), (SELECT count(*) FROM "XpEvent");`);
  const envMain = { ...env, XP_BASCULE_DATABASE: main };

  const dry = run([], envMain);
  assert.equal(dry.state, "PRE");
  assert.match(dry.result, /^DRY-RUN OK/);
  assert.equal(runner.sql(main, `SELECT count(*) FROM information_schema.columns WHERE table_name='CommunityMemberStats' AND column_name='xpBalance';`), "0");
  step("dry-run par défaut : aucune écriture", { counts, report: dry });

  const unconfirmed = run(["--execute"], envMain);
  assert.match(unconfirmed.result, /^REFUSÉ/);
  assert.equal(runner.sql(main, `SELECT count(*) FROM information_schema.columns WHERE table_name='CommunityMemberStats' AND column_name='xpBalance';`), "0");
  step("--execute sans --confirm-database refusé", { reason: unconfirmed.reason });

  const done = run(["--execute", `--confirm-database=${main}`], envMain);
  assert.equal(done.result, "BASCULE OK", JSON.stringify(done));
  assert.equal(done.fingerprintAfter, done.fingerprintBefore);
  assert.equal(done.fingerprintRestored, done.fingerprintBefore);
  assert.equal(done.mismatchedBalances, 0);
  step("bascule exécutée : sauvegarde restaurée identique, progression/objets/ledger inchangés, soldes = progression", { counts, report: done });

  // Un achat après réouverture ne doit jamais être « remboursé » par une relance.
  runner.sql(main, `UPDATE "CommunityMemberStats" SET "xpBalance" = "xpBalance" - 10 WHERE "userId" = 'u100' AND "xpBalance" >= 10;`);
  const before = runner.sql(main, `SELECT sum("xpBalance") FROM "CommunityMemberStats";`);
  const again = run(["--execute", `--confirm-database=${main}`], envMain);
  assert.match(again.result, /^DÉJÀ BASCULÉ/);
  assert.ok(again.divergentBalances >= 1);
  assert.equal(runner.sql(main, `SELECT sum("xpBalance") FROM "CommunityMemberStats";`), before);
  step("relance idempotente : aucune écriture, soldes dépensés conservés", { report: again });

  // C. Donnée négative : refus avant toute écriture
  const negative = freshDatabase("negatif");
  seed(negative, 50);
  runner.sql(negative, `UPDATE "CommunityMemberStats" SET "xpTotal" = -1 WHERE "userId" = 'u1';`);
  const refused = run(["--execute", `--confirm-database=${negative}`], { ...env, XP_BASCULE_DATABASE: negative });
  assert.match(refused.result, /^REFUSÉ/);
  assert.equal(runner.sql(negative, `SELECT count(*) FROM information_schema.columns WHERE table_name='CommunityMemberStats' AND column_name='xpBalance';`), "0");
  step("xpTotal négatif : refus, schéma intact", { reason: refused.reason });

  // D. État partiel (colonne présente, historique absent) : refus
  const partial = freshDatabase("partiel");
  seed(partial, 50);
  runner.sql(partial, `ALTER TABLE "CommunityMemberStats" ADD COLUMN "xpBalance" INTEGER NOT NULL DEFAULT 0;`);
  const part = run(["--execute", `--confirm-database=${partial}`], { ...env, XP_BASCULE_DATABASE: partial });
  assert.match(part.result, /^REFUSÉ/);
  step("état partiel : refus", { reason: part.reason });
  proof.result = "OK";
} finally {
  rmSync(work, { recursive: true, force: true });
  for (const name of created) runner.docker(["exec", target.container, "dropdb", "-U", "postgres", "--if-exists", name]);
}
console.log(JSON.stringify(proof, null, 2));
