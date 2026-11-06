import { spawnSync } from "node:child_process";

// SAFETY: builds must never change the production database schema.
// Production migrations require a separate, explicitly approved operation
// after a verified backup and review of pending migrations (#325, #329).
// This applies equally to Vercel preview and production deployments.
const steps = [
  ["node_modules/prisma/build/index.js", "generate"],
  ["node_modules/next/dist/bin/next", "build"],
];

for (const args of steps) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
