import { spawnSync } from "node:child_process";

// Les migrations sont une opération séparée, jamais une conséquence du build.
const steps = [["node_modules/prisma/build/index.js", "generate"]];
steps.push(["node_modules/next/dist/bin/next", "build"]);
for (const args of steps) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
