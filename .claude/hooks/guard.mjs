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
const norm = (s) => s.split(String.fromCharCode(92)).join("/");
const isEnvName = (name) => /^\.env(\..+)?$/.test(name) && name !== ".env.example";

// Outils fichier : on regarde uniquement le chemin.
for (const p of [input.file_path, input.path, input.notebook_path].filter(Boolean)) {
  if (isEnvName(basename(norm(p)))) block(`accès à ${basename(norm(p))} interdit.`);
  if (
    ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool) &&
    /(^|\/)prisma\/migrations\//.test(norm(p)) &&
    existsSync(resolve(process.cwd(), p))
  ) {
    block("migration Prisma existante immuable : crée-en une nouvelle.");
  }
}

// Bash : uniquement les motifs exacts.
const command = typeof input.command === "string" ? input.command : "";
if (command) {
  if (/neon\.tech/i.test(command)) block("neon.tech interdit : utilise TEST_DATABASE_URL (Postgres local).");

  // Un argument qui EST un fichier .env* (pas .env.example), pas une simple mention.
  const args = norm(command).split(/[\s"'=;|&<>()]+/);
  const isProse = /^\s*(git\s+commit|gh\s+pr)\b/.test(command); // message/corps : texte libre
  if (!isProse && args.some((a) => isEnvName(a.split("/").pop()))) block("fichier .env* interdit.");

  // Commande destructive dont la cible est une migration existante.
  if (/\b(rm|mv|sed\s+-i|git\s+(checkout|restore|rm))\b[^;&|]*prisma\/migrations\/[^\s]+/.test(norm(command))) {
    block("modification d'une migration Prisma existante interdite.");
  }
}
