import { spawnSync } from "node:child_process";

// Une Preview ne doit jamais migrer une base partagée avec la production.
// La procédure de production conserve migrate deploy avant le build.
const steps = process.env.VERCEL_ENV === "preview"
  ? [["node_modules/prisma/build/index.js", "generate"]]
  : [["node_modules/prisma/build/index.js", "migrate", "deploy"]];
steps.push(["node_modules/next/dist/bin/next", "build"]);
for (const args of steps) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
