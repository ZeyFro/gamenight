// PreToolUse : bloque .env*, neon.tech et la modification de migrations Prisma existantes.
// Exit 2 = blocage (stderr renvoyé à Claude). Aucune dépendance.
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { tool_name: tool, tool_input: input = {} } = JSON.parse(raw || "{}");

const block = (msg) => {
  console.error(`Bloqué par .claude/hooks/guard.mjs : ${msg}`);
  process.exit(2);
};

const isEnvFile = (p) => /^\.env(\..+)?$/.test(basename(p)) && basename(p) !== ".env.example";
const paths = [input.file_path, input.path, input.notebook_path].filter(Boolean);
const command = typeof input.command === "string" ? input.command : "";

for (const p of paths) {
  if (isEnvFile(p)) block(`accès à ${basename(p)} interdit (secrets). Utilise .env.example.`);
}
if (/neon\.tech/i.test(command)) {
  block("neon.tech interdit : jamais la base Neon en test. Utilise TEST_DATABASE_URL (Postgres Docker local).");
}
if (command && /(^|[\s"'=/]|\\)\.env(\.[\w.-]+)?(?=$|[\s"';|&<>])/.test(command.replace(/\.env\.example/g, ""))) {
  block("commande touchant un fichier .env* interdite.");
}

const norm = (p) => p.split(String.fromCharCode(92)).join("/");
const inMigrations = (p) => /(^|\/)prisma\/migrations\//.test(norm(p));
if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  for (const p of paths) {
    if (inMigrations(p) && existsSync(resolve(process.cwd(), p))) {
      block("migration Prisma existante immuable. Crée une nouvelle migration à la place.");
    }
  }
}
if (command && /prisma\/migrations/.test(norm(command)) &&
    /\b(rm|mv|sed\s+-i|truncate|git\s+(checkout|restore|rm|reset|clean))\b|[^>]>{1,2}[^>]/.test(command)) {
  block("commande potentiellement modificatrice sur prisma/migrations existantes.");
}
