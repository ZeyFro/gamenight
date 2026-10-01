// PreToolUse : exit 2 = blocage (stderr renvoyé à Claude). Aucune dépendance.
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { tool_name: tool, tool_input: input = {} } = JSON.parse(raw || "{}");

const block = (msg) => {
  console.error(`Bloqué par .claude/hooks/guard.mjs : ${msg}`);
  process.exit(2);
};

const file = input.file_path ? input.file_path.split(String.fromCharCode(92)).join("/") : "";

// 1. Read/Edit/Write sur .env* (sauf .env.example)
if (["Read", "Edit", "Write"].includes(tool) && /^\.env(\..+)?$/.test(basename(file)) && basename(file) !== ".env.example") {
  block(`accès à ${basename(file)} interdit.`);
}

// 2. Bash contenant neon.tech
if (tool === "Bash" && /neon\.tech/i.test(input.command ?? "")) {
  block("neon.tech interdit : utilise TEST_DATABASE_URL (Postgres local).");
}

// 3. Edit/Write sur un fichier existant de prisma/migrations
if (["Edit", "Write"].includes(tool) && /(^|\/)prisma\/migrations\//.test(file) && existsSync(resolve(process.cwd(), file))) {
  block("migration Prisma existante immuable : crée-en une nouvelle.");
}
