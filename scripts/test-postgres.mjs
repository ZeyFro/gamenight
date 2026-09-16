import { spawnSync } from "node:child_process";

if (!process.env.TEST_DATABASE_URL) {
  console.error(
    "TEST_DATABASE_URL est obligatoire et doit pointer vers une base PostgreSQL locale isolée."
  );
  process.exit(1);
}

// Les suites d'intégration historiques nettoient les mêmes tables avec
// TRUNCATE. Les fichiers doivent donc être sérialisés, sans désactiver la
// concurrence testée à l'intérieur de chaque scénario (Promise.all, workers,
// reprises de bail, etc.).
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1"],
  { stdio: "inherit", env: process.env }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
