/** Rehearsal destructive uniquement sur deux NOUVELLES bases locales isolées. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const original = process.env.TEST_DATABASE_URL;
if (!original) throw new Error("TEST_DATABASE_URL locale obligatoire");
const url = new URL(original);
if (url.hostname !== "127.0.0.1") throw new Error("127.0.0.1 uniquement, jamais de base distante");
const baseRef = process.env.PR_B_BASE_REF || "main";
const root = process.cwd();
const migrationName = "20261006190000_community_progression";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const beforeSchema = git("show", `${baseRef}:prisma/schema.prisma`);
const files = git("ls-tree", "-r", "--name-only", baseRef, "prisma/migrations").trim().split(/\r?\n/);
assert(!files.some((f) => f.includes(migrationName)), "La base de rehearsal doit précéder PR B");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gamenight-prb-migration-"));
fs.writeFileSync(path.join(tmp, "schema.prisma"), beforeSchema);
for (const file of files) {
  const dest = path.join(tmp, file.replace(/^prisma\//, ""));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, git("show", `${baseRef}:${file}`));
}
const runPrisma = (args, databaseUrl) => execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), ...args], {
  cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", stdio: "pipe",
});
const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
const stamp = Date.now().toString(36);
const reports = [];
try {
  for (const defaultMissing of [false, true]) {
    const dbName = `gamenight_prb_rehearsal_${stamp}_${defaultMissing ? "missing" : "present"}`;
    assert(/^[a-z0-9_]+$/.test(dbName));
    // Bases créées neuves : aucun DROP ni reset d'une base existante.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const target = new URL(url); target.pathname = `/${dbName}`;
    const targetUrl = target.toString();
    runPrisma(["migrate", "deploy", "--schema", path.join(tmp, "schema.prisma")], targetUrl);
    const db = new PrismaClient({ datasourceUrl: targetUrl });
    try {
      const exec = (query, ...params) => db.$executeRawUnsafe(query, ...params);
      if (defaultMissing) await exec(`DELETE FROM "Community" WHERE slug='default'`);
      await exec(`INSERT INTO "Community" (id,slug,name,status,"updatedAt") VALUES ('other','other','Other','ACTIVE',now())`);
      await exec(`INSERT INTO "User" (id,"discordId","discordName","xpTotal","streakCount","streakLastActiveAt","bestStreakCount") VALUES ('historical','history','History',137,4,'2026-09-25',18)`);
      await exec(`INSERT INTO "UserLifetimeStats" ("userId","tournamentsParticipatedCount") VALUES ('historical',11)`);
      await exec(`INSERT INTO "XpEvent" (id,"userId",reason,"sourceId",amount) VALUES ('xp-historical','historical','VOTE','old-source',999)`);
      await exec(`INSERT INTO "LevelUpEvent" (id,"userId",level) VALUES ('level-historical','historical',4)`);
      await exec(`INSERT INTO "Badge" (id,name,icon,description,category,rarity,criteria,"xpReward","modifiedById","modifiedAt") VALUES ('badge-historical','Old','B','old','ENGAGEMENT','COMMON','{"type":"STREAK_DAYS","count":4}',20,'historical',now())`);
      await exec(`INSERT INTO "UserBadge" (id,"userId","badgeId") VALUES ('ub-historical','historical','badge-historical')`);
      await exec(`INSERT INTO "Game" (id,name,source,"addedById") VALUES ('game-historical','Game','MANUAL','historical')`);
      await exec(`INSERT INTO "Session" (id,date,"createdById",status,"communityId") VALUES ('collision-parent',now(),'historical','DONE',NULL),('other-session',now(),'historical','DONE','other')`);
      await exec(`INSERT INTO "Tournament" (id,name,"gameId","createdById","maxPlayers","communityId") VALUES ('collision-parent','Tournament','game-historical','historical',8,'other')`);
      await exec(`INSERT INTO "SessionResult" (id,"sessionId","userId",placement) VALUES ('result-live','other-session','historical',1),('result-purged',NULL,'historical',2)`);
      await exec(`INSERT INTO "Notification" (id,"userId",type,title,message,"relatedSessionId") VALUES ('notif-live','historical','SESSION_RESULT','T','M','other-session'),('notif-purged','historical','LEVEL_UP','T','M',NULL)`);
      await exec(`INSERT INTO "NotificationEvent" (id,category,"eventType","sourceId") VALUES ('event-session','SESSION','CREATED','collision-parent'),('event-tournament','TOURNAMENT','CREATED','collision-parent'),('event-purged','REWARD','REWARD','missing-source')`);
      const tables = ["User", "UserLifetimeStats", "XpEvent", "LevelUpEvent", "UserBadge", "SessionResult", "Notification", "NotificationEvent", "Session", "Tournament"];
      const originalRows = {};
      for (const table of tables) originalRows[table] = await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY ${table === "UserLifetimeStats" ? '"userId"' : 'id'}`);
      const sql = fs.readFileSync(path.join(root, "prisma/migrations", migrationName, "migration.sql"), "utf8");
      const statements = sql.replace(/\bBEGIN;|\bCOMMIT;/g, "").split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
      await db.$transaction(async (tx) => { for (const statement of statements) await tx.$executeRawUnsafe(statement); });
      // Reconnexion après DDL : les anciens SELECT * préparés ont changé de type.
      await db.$disconnect();
      await db.$connect();
      const defaults = await db.$queryRawUnsafe(`SELECT id FROM "Community" WHERE slug='default'`);
      assert.equal(defaults.length, 1); const defaultId = defaults[0].id;
      for (const table of tables) {
        const rows = await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY ${table === "UserLifetimeStats" ? '"userId"' : 'id'}`);
        const stripped = rows.map(({ communityId, ...row }) => {
          delete row.payload;
          // Session/Tournament avaient déjà communityId : il fait partie de l'historique conservé.
          return ["Session", "Tournament"].includes(table) ? { ...row, communityId } : row;
        });
        assert.deepEqual(stripped, originalRows[table], `Conservation intégrale ${table}`);
      }
      const stats = await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId: defaultId, userId: "historical" } } });
      assert.equal(stats.xpTotal, 137); assert.equal(stats.streakCount, 4); assert.equal(stats.bestStreakCount, 18); assert.equal(stats.tournamentsParticipatedCount, 11);
      assert.equal(stats.streakLastActiveAt.toISOString(), "2026-09-25T00:00:00.000Z");
      assert.equal((await db.xpEvent.findUniqueOrThrow({ where: { id: "xp-historical" } })).communityId, defaultId);
      assert.equal((await db.levelUpEvent.findUniqueOrThrow({ where: { id: "level-historical" } })).communityId, defaultId);
      assert.equal((await db.userBadge.findUniqueOrThrow({ where: { id: "ub-historical" } })).communityId, defaultId);
      assert.equal((await db.sessionResult.findUniqueOrThrow({ where: { id: "result-live" } })).communityId, "other");
      assert.equal((await db.sessionResult.findUniqueOrThrow({ where: { id: "result-purged" } })).communityId, defaultId);
      assert.equal((await db.notificationEvent.findUniqueOrThrow({ where: { id: "event-session" } })).communityId, defaultId);
      assert.equal((await db.notificationEvent.findUniqueOrThrow({ where: { id: "event-tournament" } })).communityId, "other");
      await db.xpEvent.create({ data: { communityId: "other", userId: "historical", reason: "VOTE", sourceId: "old-source", amount: 10 } });
      await db.userBadge.create({ data: { communityId: "other", userId: "historical", badgeId: "badge-historical" } });
      await db.communityMemberStats.create({ data: { communityId: "other", userId: "historical", xpTotal: 500 } });
      const diff = runPrisma(["migrate", "diff", "--from-url", targetUrl, "--to-schema-datamodel", path.join(root, "prisma/schema.prisma"), "--exit-code"], targetUrl);
      assert.match(diff, /No difference detected/);
      // Provenance doit rester identique après purge du parent et du serveur.
      await exec(`DELETE FROM "Session" WHERE id='other-session'`);
      await exec(`DELETE FROM "Community" WHERE id='other'`);
      assert.equal((await db.sessionResult.findUniqueOrThrow({ where: { id: "result-live" } })).communityId, "other");
      assert.equal((await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId: "other", userId: "historical" } } })).xpTotal, 500);
      reports.push({ database: dbName, defaultMissing, baselineMigrations: files.filter((f) => f.endsWith("migration.sql")).length, conservation: "PASS", exactBalance: "PASS", separateKeys: "PASS", durableProvenance: "PASS", prismaDrift: "NONE" });
    } finally { await db.$disconnect(); }
  }
  console.log(JSON.stringify(reports, null, 2));
} finally { await admin.$disconnect(); }
