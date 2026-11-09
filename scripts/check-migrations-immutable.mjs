#!/usr/bin/env node
// Garde CI : une migration Prisma déjà intégrée à la branche de référence est IMMUABLE.
//
// Principe : on compare l'arbre `prisma/migrations/` du point de départ de la PR
// (merge-base entre la base et la tête) à celui de la tête de la PR.
//   - Un fichier présent au point de départ doit exister, au même chemin, avec le même
//     contenu et le même mode dans la tête : sinon modification, suppression ou
//     déplacement (un renommage = suppression de l'ancien chemin, donc refusé).
//   - Un fichier absent du point de départ est nouveau : autorisé. Les migrations
//     ajoutées par la PR elle-même ne sont jamais comparées à elles-mêmes.
// Le merge-base (et non la tête actuelle de `main`) évite de refuser une PR en retard
// sur `main` : les migrations arrivées dans `main` depuis ne sont pas des suppressions.
//
// Usage : node scripts/check-migrations-immutable.mjs --base <rev> [--head <rev>]
// Codes de sortie : 0 conforme · 1 violation · 2 erreur d'usage ou d'environnement
// (garde mal configurée : jamais un succès à vide). Aucune dépendance, aucun réseau.
//
// Limite : la PR qui modifierait ce script ou son workflow s'exécute avec sa propre copie.
// Le workflow exécute donc la copie de la branche de base dès qu'elle existe ; la
// modification du workflow lui-même reste soumise à la relecture du propriétaire.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const MIGRATIONS_DIR = "prisma/migrations";

/** Analyse la sortie `git ls-tree -r -z` : Map chemin → « mode:blob » (symlinks et modes inclus). */
export function parseLsTree(output) {
  const entries = new Map();
  for (const record of String(output).split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error(`sortie ls-tree illisible : ${JSON.stringify(record.slice(0, 80))}`);
    const [mode, type, blob] = record.slice(0, tab).split(" ");
    if (!mode || !type || !blob) throw new Error(`sortie ls-tree illisible : ${JSON.stringify(record.slice(0, 80))}`);
    entries.set(record.slice(tab + 1), `${mode}:${blob}`);
  }
  return entries;
}

/**
 * Violations entre les entrées de base et de tête.
 * kind : modified (même chemin, contenu ou mode différent) · deleted · renamed (supprimé ici,
 * contenu identique réapparu à un chemin nouveau : `to`).
 */
export function findViolations(baseEntries, headEntries) {
  const added = [];
  for (const [path, id] of headEntries) if (!baseEntries.has(path)) added.push([path, id]);
  const violations = [];
  for (const [path, id] of [...baseEntries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!headEntries.has(path)) {
      const target = added.find(([, headId]) => headId === id);
      violations.push(target ? { kind: "renamed", path, to: target[0] } : { kind: "deleted", path });
    } else if (headEntries.get(path) !== id) {
      violations.push({ kind: "modified", path });
    }
  }
  return violations;
}

export function describeViolation(v) {
  if (v.kind === "renamed") return `${v.path} : déplacé ou renommé vers ${v.to}`;
  if (v.kind === "deleted") return `${v.path} : supprimé`;
  if (v.kind === "removed") return `${v.path} : présent dans la base et dans l'historique de la PR, mais absent de la PR (supprimé ou déplacé)`;
  if (v.kind === "diverged") return `${v.path} : diffère de la branche de base (migration déjà intégrée à la base, modifiée ou ajoutée en double)`;
  return `${v.path} : modifié`;
}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...options });
}

function treeOf(rev) {
  return parseLsTree(git(["ls-tree", "-r", "-z", rev, "--", MIGRATIONS_DIR]));
}

/**
 * Chemins présents à la fois dans la TÊTE de la base et dans la tête de la PR avec un contenu
 * différent. Complète la comparaison au merge-base, qui peut être trop ancien (parent d'une PR
 * de pile fusionné en squash puis PR retargetée sur la base ; historiques croisés) et prendre
 * pour « nouvelle » une migration déjà intégrée. Une PR en retard (migration arrivée dans la
 * base mais absente de la PR) n'est PAS concernée : le chemin est absent de la tête de la PR.
 */
export function findDivergences(baseTipEntries, headEntries, alreadyFlagged = new Set()) {
  const divergences = [];
  for (const [path, id] of baseTipEntries) {
    if (headEntries.has(path) && headEntries.get(path) !== id && !alreadyFlagged.has(path)) divergences.push({ kind: "diverged", path });
  }
  return divergences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Chemins présents dans la TÊTE de la base, absents de la tête de la PR, mais présents dans l'HISTORIQUE
 * de la PR (elle les a eus puis retirés). Couvre une suppression/un déplacement après un parent fusionné en
 * squash, que ni le merge-base ni la comparaison de tête ne voient. Une PR simplement en retard (la
 * migration n'a jamais existé dans son historique) n'est pas concernée.
 */
export function findHistoricalRemovals(baseTipEntries, headEntries, historyPaths, alreadyFlagged = new Set()) {
  const removed = [];
  for (const path of baseTipEntries.keys()) {
    if (!headEntries.has(path) && historyPaths.has(path) && !alreadyFlagged.has(path)) removed.push({ kind: "removed", path });
  }
  return removed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function historyPathsOf(rev) {
  const output = git(["log", "--format=", "--name-only", "-z", rev, "--", MIGRATIONS_DIR]);
  return new Set(output.split("\0").filter(Boolean));
}

/** Exécution complète pour deux révisions. Retourne { code, lines }. */
export function check(baseRev, headRev = "HEAD") {
  const lines = [];
  let mergeBase;
  try {
    mergeBase = git(["merge-base", baseRev, headRev]).trim();
  } catch {
    return { code: 2, lines: [`ERREUR : aucun point de départ commun entre ${baseRev} et ${headRev} (historique tronqué ? utiliser fetch-depth: 0).`] };
  }
  let baseEntries;
  let baseTipEntries;
  let headEntries;
  try {
    baseEntries = treeOf(mergeBase);
    baseTipEntries = treeOf(baseRev);
    headEntries = treeOf(headRev);
  } catch (error) {
    return { code: 2, lines: [`ERREUR : lecture de l'arbre git impossible (${String(error.message).split("\n")[0]}).`] };
  }
  if (baseEntries.size === 0) {
    return { code: 2, lines: [`ERREUR : aucune migration à la base ${mergeBase.slice(0, 12)} : garde mal configurée, refus de passer à vide.`] };
  }
  const violations = findViolations(baseEntries, headEntries);
  violations.push(...findDivergences(baseTipEntries, headEntries, new Set(violations.map((v) => v.path))));
  if ([...baseTipEntries.keys()].some((path) => !headEntries.has(path))) {
    try {
      violations.push(...findHistoricalRemovals(baseTipEntries, headEntries, historyPathsOf(headRev), new Set(violations.map((v) => v.path))));
    } catch (error) {
      return { code: 2, lines: [`ERREUR : lecture de l'historique git impossible (${String(error.message).split("\n")[0]}).`] };
    }
  }
  const added = [...headEntries.keys()].filter((path) => !baseEntries.has(path));
  if (violations.length > 0) {
    lines.push(`REFUS : ${violations.length} fichier(s) de ${MIGRATIONS_DIR}/ déjà intégré(s) à la base ${mergeBase.slice(0, 12)} ont été touchés.`);
    for (const v of violations) lines.push(`  - ${describeViolation(v)}`);
    lines.push("Les migrations existantes sont immuables : créer une NOUVELLE migration additive à la place.");
    return { code: 1, lines };
  }
  lines.push(`OK : ${baseEntries.size} fichier(s) de migration existants intacts ; ${added.length} fichier(s) nouveau(x) autorisé(s).`);
  return { code: 0, lines };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--base" || arg === "--head") && argv[i + 1]) {
      options[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      return { error: `argument inconnu : ${arg}` };
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.error || !options.base) {
    console.error(`${options.error ?? "--base <rev> est obligatoire"}\nUsage : node scripts/check-migrations-immutable.mjs --base <rev> [--head <rev>]`);
    process.exit(2);
  }
  const { code, lines } = check(options.base, options.head ?? "HEAD");
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
