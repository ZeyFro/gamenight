// Renommage des 6 migrations du lot XP + vocal avec l'horodatage RÉEL du moment (phase 4). À lancer UNIQUEMENT quand le
// propriétaire a confirmé « #370 et #406 mergées et migrées, #325 peut passer en phase 4 », après avoir fusionné `main` dans la branche.
//
//   node scripts/rename-xp-lot-migrations.mjs                       # dry-run (défaut) : plan, fichiers touchés, refus éventuels
//   node scripts/rename-xp-lot-migrations.mjs --apply               # renomme (git mv) + remplace les noms + bascule XP_LOT_RENAMED
//   options : --timestamp=AAAAMMJJhhmmss (UTC, jamais dans le futur ; défaut = maintenant)
//
// Garanties : aucune date future ; lot STRICTEMENT postérieur à toutes les autres migrations du checkout (donc à celles de main,
// #370, #406, #407…) ; ordre et suffixes conservés ; migration.sql jamais modifié (empreinte sha256 vérifiée avant/après) ;
// arbre de travail propre exigé pour --apply ; aucune connexion base, aucun accès réseau.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { EXPECTED_ROLLOUT_MIGRATIONS } from "./xp-rollout-migration-gate.mjs";
import {
  formatTimestamp, isBatchAfterOthers, isRewritable, planRename, renderMappingSection, replaceNames,
} from "./rename-xp-lot-migrations-lib.mjs";

const MIGRATIONS = "prisma/migrations";
const GATE = "scripts/xp-rollout-migration-gate.mjs";

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr.trim()}`);
  return r.stdout;
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function parseArgs(argv) {
  const args = { apply: false, timestamp: undefined };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--timestamp=")) args.timestamp = arg.slice("--timestamp=".length);
    else throw new Error(`Argument inconnu : ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gateText = readFileSync(GATE, "utf8");
  const alreadyRenamed = /export const XP_LOT_RENAMED = true;/.test(gateText);
  const batch = [...EXPECTED_ROLLOUT_MIGRATIONS];
  const all = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(`${MIGRATIONS}/${e.name}/migration.sql`)).map((e) => e.name);
  for (const name of batch) if (!all.includes(name)) throw new Error(`Migration du lot absente du checkout : ${name}`);
  const others = all.filter((name) => !batch.includes(name));
  // Déjà renommé ET toujours postérieur à tout le reste : rien à faire. Si une migration plus récente est arrivée depuis
  // (autre PR fusionnée avant le merge de #325), le lot est renommé une seconde fois avec l'horodatage réel du moment.
  if (alreadyRenamed && isBatchAfterOthers(batch, others)) {
    console.log("Rien à faire : lot déjà renommé et postérieur à toutes les autres migrations.");
    return;
  }
  if (alreadyRenamed) console.log("Re-renommage : une migration plus récente que le lot est apparue depuis le premier renommage.");
  const now = new Date();
  const base = args.timestamp ?? formatTimestamp(now);
  const mapping = planRename({ batch, others, base, now });

  const files = git(["grep", "-lE", batch.join("|"), "--", "."]).split("\n").filter(Boolean);
  const rewritable = files.filter(isRewritable);
  const kept = files.filter((f) => !isRewritable(f) && !f.startsWith("prisma/migrations/"));

  console.log(`Plan (${args.apply ? "APPLICATION" : "dry-run"}) — autres migrations: ${others.length}, la plus récente: ${others.map((n) => n.slice(0, 14)).sort().pop()}`);
  for (const m of mapping) console.log(`  ${m.from}\n    -> ${m.to}`);
  console.log(`Fichiers réécrits (${rewritable.length}) : ${rewritable.join(", ")}`);
  console.log(`Fichiers historiques laissés tels quels (${kept.length}) : ${kept.join(", ") || "aucun"}`);
  if (!args.apply) {
    console.log("Dry-run : aucune écriture. Relancer avec --apply sur une branche propre, après fusion de main et accord du propriétaire.");
    return;
  }
  if (git(["status", "--porcelain"]).trim() !== "") throw new Error("Arbre de travail non propre : committer ou remiser avant --apply");

  const before = new Map(mapping.map((m) => [m.from, sha(`${MIGRATIONS}/${m.from}/migration.sql`)]));
  for (const m of mapping) git(["mv", `${MIGRATIONS}/${m.from}`, `${MIGRATIONS}/${m.to}`]);
  for (const m of mapping) {
    const after = sha(`${MIGRATIONS}/${m.to}/migration.sql`);
    if (after !== before.get(m.from)) throw new Error(`Empreinte modifiée pour ${m.to} : renommage annulé à contrôler à la main`);
  }
  for (const file of rewritable) {
    const text = readFileSync(file, "utf8");
    const next = replaceNames(text, mapping);
    if (next !== text) writeFileSync(file, next);
  }
  writeFileSync(GATE, readFileSync(GATE, "utf8").replace("export const XP_LOT_RENAMED = false;", "export const XP_LOT_RENAMED = true;"));
  const livraison = "docs/LIVRAISON-XP.md";
  if (existsSync(livraison)) {
    const title = alreadyRenamed ? "\n## 9 bis. Nouveau renommage" : "\n## 9. Renommage";
    writeFileSync(livraison, readFileSync(livraison, "utf8").trimEnd() + "\n" + renderMappingSection(mapping, now.toISOString().slice(0, 10)).replace("\n## 9. Renommage", title));
  }
  console.log("Renommage appliqué. Suite : node scripts/check-xp-rollout-migration-gate.mjs ; npx vitest run src/lib/xp-rollout-gate.test.ts src/lib/xp-lot-rename.test.ts ; prisma migrate deploy sur base jetable ; committer ; un seul push.");
}

try { main(); } catch (error) { console.error(`REFUS : ${error.message}`); process.exit(2); }
