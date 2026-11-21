// Exécute les fichiers de test cités dans la colonne « Preuve » de docs/COUVERTURE_CAHIER.md et enregistre le résultat par fichier.
// Les tests d'intégration visent la base jetable gamenight_test (jamais gamenight_preuves, jamais Neon), un fichier à la fois.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const cahier = readFileSync("docs/COUVERTURE_CAHIER.md", "utf8");
const cited = [...new Set([...cahier.matchAll(/`([^`/ ]+\.test\.tsx?)`|`((?:src|scripts)\/[^`]+\.test\.tsx?)`/g)].map(match => match[1] ?? match[2]))];
const all = execFileSync("git", ["ls-files", "src", "scripts"], { encoding: "utf8" }).split("\n").filter(file => /\.test\.tsx?$/.test(file));
const resolved = {};
for (const name of cited) {
  const hit = all.filter(file => file === name || file.endsWith("/" + name));
  resolved[name] = hit;
}
const files = [...new Set(Object.values(resolved).flat())];
const integration = files.filter(file => file.includes(".integration.") || file.includes(".regression.integration"));
const unit = files.filter(file => !integration.includes(file));
console.log(`citations : ${cited.length}, fichiers : ${files.length} (unitaires ${unit.length}, intégration ${integration.length})`);
mkdirSync("logs", { recursive: true });

const results = {};
function run(list, label, env) {
  if (!list.length) return;
  const outputFile = `logs/vitest-${label}.json`;
  const args = ["vitest", "run", "--reporter=json", `--outputFile=${outputFile}`, ...(label === "integration" ? ["--no-file-parallelism"] : []), ...list];
  spawnSync("npx", args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"], maxBuffer: 1 << 28 });
  const json = JSON.parse(readFileSync(outputFile, "utf8"));
  for (const file of json.testResults) {
    const rel = file.name.slice(file.name.indexOf("/src/") + 1) || file.name;
    const relative = file.name.replace(process.cwd() + "/", "");
    const tests = file.assertionResults;
    results[relative] = {
      status: file.status, passed: tests.filter(test => test.status === "passed").length, failed: tests.filter(test => test.status === "failed").length,
      skipped: tests.filter(test => ["skipped", "pending", "todo"].includes(test.status)).length, total: tests.length,
      failures: tests.filter(test => test.status === "failed").map(test => test.fullName).slice(0, 5), message: file.message?.slice(0, 300) ?? "", kind: label,
    };
  }
}
run(unit, "unitaire", {});
run(integration, "integration", { TEST_DATABASE_URL: "postgresql://postgres:test@127.0.0.1:55439/gamenight_test" });
writeFileSync("docs/preuves/tests-resultats.json", JSON.stringify({ resolved, results }, null, 1));
const summary = Object.values(results);
console.log(`fichiers exécutés : ${summary.length}, réussis : ${summary.filter(r => r.status === "passed").length}, échoués : ${summary.filter(r => r.status === "failed").length}`);
