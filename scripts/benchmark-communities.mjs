import { spawnSync } from "node:child_process";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("TEST_DATABASE_URL required (dedicated local load database)");
const url = new URL(value);
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !/^\/gamenight_load_[a-z0-9_]+$/.test(url.pathname)) {
  throw new Error("Requires 127.0.0.1 and a disposable gamenight_load_* database; benchmark TRUNCATES it");
}
// All HTTP is mocked by the benchmark. No production adapter/environment.
const env = { ...process.env, DATABASE_URL: value, NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) if (/^DISCORD_.*(TOKEN|SECRET|WEBHOOK)/.test(key)) env[key] = "";
for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["node_modules/vitest/vitest.mjs", "run", "--config", "scripts/community-load.config.mts", "--maxWorkers=1"],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
