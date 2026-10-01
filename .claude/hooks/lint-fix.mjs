// PostToolUse : eslint --fix sur le seul fichier édité. Exit 2 si des erreurs restent.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const file = JSON.parse(raw || "{}").tool_input?.file_path;

if (!file || !/\.(ts|tsx|js|jsx|mjs|mts)$/.test(file) || !existsSync(file)) process.exit(0);

const r = spawnSync(process.execPath, ["node_modules/eslint/bin/eslint.js", "--fix", file], {
  encoding: "utf8",
});
if (r.status !== 0) {
  console.error(`eslint : erreurs restantes dans ${file}\n${(r.stdout + r.stderr).trim().slice(0, 1500)}`);
  process.exit(2);
}
