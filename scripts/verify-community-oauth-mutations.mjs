import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const url = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !/^\/gamenight_community_[a-z0-9_]+$/.test(url.pathname)) {
  throw new Error("Dedicated local gamenight_community_* Postgres required; tests TRUNCATE");
}
const mutations = [
  { name: "removed", file: "src/lib/community-oauth.ts", from: 'status: { in: ["ACTIVE", "LEFT"] }', to: 'status: { in: ["ACTIVE", "LEFT", "REMOVED"] }', test: "src/lib/community-oauth.integration.test.ts", filter: "REMOVED stays" },
  { name: "pending", file: "src/lib/community-oauth.ts", from: 'where: { status: "ACTIVE", discordGuildId: { in: guildIds } }', to: 'where: { discordGuildId: { in: guildIds } }', test: "src/lib/community-oauth.integration.test.ts", filter: "unknown, PENDING" },
  { name: "partial", file: "src/lib/discord-user-guilds.ts", from: 'if (response.status !== 200) throw new Error("Discord guild snapshot unavailable");', to: 'if (response.status !== 200) return [...ids];', test: "src/lib/discord-user-guilds.test.ts", filter: "partial response" },
  { name: "picker-fallback", file: "src/lib/community-isolation.ts", from: 'if (state.kind === "needs-choice") return null;', to: '', test: "src/lib/community-oauth.integration.test.ts", filter: "foreign saved preference" },
  { name: "home-selection", file: "src/lib/home.ts", from: 'return scopedDb.session.findFirst({', to: 'return prisma.session.findFirst({', test: "src/lib/community-oauth.integration.test.ts", filter: "shared user A then B" },
  { name: "gate-open", file: "src/auth.ts", from: 'if (isAdmin || activeIds.length > 0) return true;', to: 'return true;', test: "src/auth.signin.fail-closed.test.ts", filter: "variable absente" },
  { name: "admin-lockout", file: "src/auth.ts", from: 'const isAdmin = parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS).has(profile.id as string);', to: 'const isAdmin = false;', test: "src/auth.signin.fail-closed.test.ts", filter: "admin" },
  { name: "scope", file: "src/auth.ts", from: '.includes("guilds")', to: '.includes("identify")', test: "src/auth.signin.fail-closed.test.ts", filter: "portée Discord" },
  { name: "rollback", file: "src/auth.ts", from: 'if (!existed) throw new NotAdmitted();', to: '', test: "src/lib/community-oauth.integration.test.ts", filter: "inconnu : serveur absent" },
];
const directory = mkdtempSync(join(tmpdir(), "gamenight-community-oauth-mutations-"));
const results = [];
const hash = (data) => createHash("sha256").update(data).digest("hex");
for (const m of mutations) {
  const original = readFileSync(m.file);
  const source = original.toString("utf8");
  if (source.split(m.from).length !== 2) throw new Error(`Mutation anchor not unique: ${m.name}`);
  const output = join(directory, `${m.name}.json`);
  try {
    writeFileSync(m.file, source.replace(m.from, m.to));
    const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", m.test, "--maxWorkers=1", "-t", m.filter, "--reporter=json", `--outputFile=${output}`], { encoding: "utf8", env: process.env });
    writeFileSync(join(directory, `${m.name}.log`), (run.stdout ?? "") + (run.stderr ?? ""));
    if (run.error) throw run.error;
    const report = JSON.parse(readFileSync(output, "utf8"));
    const assertions = report.testResults.flatMap((r) => r.assertionResults);
    const failed = assertions.filter((a) => a.status === "failed").length;
    const excluded = assertions.filter((a) => ["pending", "skipped"].includes(a.status)).length;
    results.push({ name: m.name, detected: run.status !== 0 && failed > 0, failed, excluded });
  } finally {
    writeFileSync(m.file, original);
    if (hash(readFileSync(m.file)) !== hash(original)) throw new Error(`Restore failure: ${m.file}`);
  }
}
writeFileSync(join(directory, "report.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ directory, results }));
if (results.some((r) => !r.detected)) process.exit(1);
