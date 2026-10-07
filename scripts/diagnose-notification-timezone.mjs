/** Quatre scénarios réels, en série, sur une base locale jetable déjà migrée. Aucun réseau Discord. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert(!process.env.DISCORD_WEBHOOK_URL && !process.env.DISCORD_BOT_TOKEN, "Aucun secret Discord");
const database = decodeURIComponent(url.pathname.slice(1));
assert(/^gamenight_prb_[a-z0-9_]+$/.test(database), "Base PR B jetable uniquement");
const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gamenight-prb-timezones-"));
const report = [];
try {
  for (const timezone of ["UTC", "Europe/Paris"]) {
    await admin.$executeRawUnsafe(`ALTER DATABASE "${database}" SET timezone TO '${timezone}'`);
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      const now = new Date("2026-10-06T12:00:00Z");
      const timeZone = await db.$queryRawUnsafe("SHOW TimeZone");
      const parameter = await db.$queryRaw`SELECT pg_typeof(${now})::text AS type`;
      const column = await db.$queryRaw`SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'NotificationDelivery' AND column_name = 'nextAttemptAt'`;
      const id = randomUUID();
      const event = await db.notificationEvent.create({ data: { category: "REWARD", eventType: "TIMEZONE_DIAGNOSTIC", sourceId: id } });
      const delivery = await db.notificationDelivery.create({ data: { eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: id, targetSlot: id, nextAttemptAt: new Date(now.getTime() + 12_000) } });
      const early = new Date(now.getTime() + 5_000);
      const comparison = await db.$queryRaw`SELECT "nextAttemptAt"::text AS stored, "nextAttemptAt" <= ${early} AS due_implicit,
        "nextAttemptAt" <= (${early}::timestamptz AT TIME ZONE 'UTC') AS due_utc
        FROM "NotificationDelivery" WHERE id = ${delivery.id}`;
      await db.notificationEvent.delete({ where: { id: event.id } });
      const outputFile = path.join(tmp, `${timezone.replace("/", "-")}.json`);
      const pattern = "archivage : 429 retry_after=12|runExecutorBatch propage sa propre|une fois le fil créé, le rappel en attente devient|le nettoyage attend tant que le SEND";
      const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run",
        "src/lib/discord-thread-cleanup.integration.test.ts", "src/lib/notification-executor.integration.test.ts", "src/lib/session-announce.integration.test.ts",
        "--maxWorkers=1", "-t", pattern, "--reporter=json", `--outputFile=${outputFile}`], {
        env: { ...process.env, TEST_DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 120_000,
      });
      fs.writeFileSync(`${outputFile}.log`, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
      const tests = JSON.parse(fs.readFileSync(outputFile, "utf8"));
      const assertions = tests.testResults.flatMap((file) => file.assertionResults ?? []);
      const executed = assertions.filter((test) => ["passed", "failed"].includes(test.status));
      assert.equal(executed.length, 4, "Les quatre tests doivent réellement être exécutés");
      const entry = { timezone, timeZone, column, parameter, comparison, exitCode: result.status,
        tests: executed.map(({ fullName, status, failureMessages }) => ({ fullName, status, failureMessages })),
        excluded: assertions.length - executed.length,
      };
      report.push(entry); console.log(JSON.stringify(entry, null, 2));
    } finally { await db.$disconnect(); }
  }
} finally {
  await admin.$executeRawUnsafe(`ALTER DATABASE "${database}" RESET timezone`);
  await admin.$disconnect();
  fs.writeFileSync(path.join(tmp, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Rapport : ${path.join(tmp, "report.json")}`);
}
if (process.argv.includes("--expect-pass") && report.some((entry) => entry.exitCode !== 0)) process.exitCode = 1;
