#!/usr/bin/env node
// Ignored Build Step Vercel : évite les builds Preview inutiles (docs, workflows GitHub,
// outillage Neon Test). Branché par `ignoreCommand` dans vercel.json.
//
// Contrat Vercel : code 0 = build IGNORÉ ; code 1 = build EXÉCUTÉ.
// Règle de sûreté : on n'ignore QUE si l'on a PROUVÉ que tous les fichiers modifiés depuis le
// dernier déploiement réussi de la branche sont hors application. Au moindre doute (production,
// branche principale, premier déploiement de la branche, SHA absent, git en échec, liste
// vide ou illisible), on construit. La CI GitHub (verify) n'est pas concernée.
//
// Aucun secret, aucune dépendance, aucun réseau.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Chemins sans effet sur l'application déployée (conservateur : ni src/, ni prisma/, ni package*.json). */
export const IGNORABLE = [
  /^docs\//,
  /^\.github\//,
  /^\.claude\//,
  /^scripts\/neon-test\//,
  /^[^/]+\.md$/,
];

export const isIgnorablePath = (path) => IGNORABLE.some((pattern) => pattern.test(path));

/**
 * Décision pure. Retourne { skip, reason }.
 * `changedFiles` : tableau de chemins, ou null si indéterminable (=> build).
 */
export function decide({ env, changedFiles }) {
  if (env.VERCEL_ENV === "production") return { skip: false, reason: "environnement production : toujours construit" };
  if (env.VERCEL_GIT_COMMIT_REF === "main") return { skip: false, reason: "branche main : toujours construite" };
  if (!env.VERCEL_GIT_COMMIT_SHA) return { skip: false, reason: "SHA du commit absent" };
  if (!env.VERCEL_GIT_PREVIOUS_SHA) return { skip: false, reason: "premier déploiement de la branche (pas de SHA précédent)" };
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return { skip: false, reason: "liste des fichiers modifiés indéterminable ou vide" };
  const relevant = changedFiles.filter((path) => !isIgnorablePath(path));
  if (relevant.length > 0) return { skip: false, reason: `fichier(s) applicatif(s) modifié(s) : ${relevant.slice(0, 3).join(", ")}${relevant.length > 3 ? ", …" : ""}` };
  return { skip: true, reason: `${changedFiles.length} fichier(s) modifié(s), tous hors application (docs, workflows, outillage)` };
}

function changedFilesBetween(previous, current) {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", previous, current], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\0").filter(Boolean);
  } catch {
    return null; // objet absent (clone superficiel), SHA invalide, git indisponible
  }
}

export function run(env = process.env) {
  const previous = env.VERCEL_GIT_PREVIOUS_SHA;
  const current = env.VERCEL_GIT_COMMIT_SHA;
  const changedFiles = previous && current ? changedFilesBetween(previous, current) : null;
  const { skip, reason } = decide({ env, changedFiles });
  console.log(`[ignore-build] ${skip ? "build IGNORÉ" : "build EXÉCUTÉ"} : ${reason}`);
  return skip ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run());
}
