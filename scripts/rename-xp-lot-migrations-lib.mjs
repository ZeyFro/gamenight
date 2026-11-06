// Fonctions pures du renommage des 6 migrations du lot XP + vocal (phase 4). Aucune écriture : voir rename-xp-lot-migrations.mjs.
import assert from "node:assert/strict";

const TS = /^(\d{14})_(.+)$/;

/** Documents historiques : décrivent des répétitions faites sous les anciens noms, jamais réécrits (voir la table de correspondance). */
export const HISTORICAL_DOCS = [
  "docs/MISSION-20261019.md",
  "docs/XP-BALANCE-20261019.md",
  "docs/XP-REPETITION-COMPLETE.md",
  "docs/XP-ROLE-BARRIER-REHEARSAL.md",
  "docs/XP-ROLLOUT-DECISION-20261019.md",
];
/**
 * Fixtures de la PR Tower #370 qui utilisent volontairement l'ANCIEN nom du lot comme « migration plus ancienne » : les réécrire avec
 * l'horodatage réel casserait leurs tests (constaté en simulation).
 */
export const FIXTURE_FILES = ["scripts/db-migrate-lib.test.mjs"];
/** Chemins jamais touchés par le remplacement de texte. */
export const NEVER_REWRITE_PREFIXES = ["prisma/migrations/", "docs/archive/", "docs/xp-phase4/", "node_modules/", ".next/"];

export function timestampOf(name) {
  const m = TS.exec(name);
  assert.ok(m, `Nom de migration invalide : ${name}`);
  return m[1];
}
export function suffixOf(name) {
  return TS.exec(name)?.[2] ?? assert.fail(`Nom de migration invalide : ${name}`);
}

export function parseTimestamp(value) {
  assert.match(String(value), /^\d{14}$/, "Horodatage attendu : AAAAMMJJhhmmss (UTC, 14 chiffres)");
  const s = String(value);
  const date = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));
  assert.equal(formatTimestamp(date), s, `Horodatage inexistant : ${s}`);
  return date;
}
export function formatTimestamp(date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

/** Marge d'horloge acceptée pour « l'instant réel » (aucune date future, décision D1). */
export const CLOCK_TOLERANCE_MS = 60_000;

/**
 * Plan de renommage : les 6 noms du lot reçoivent base, base+1 s, … base+5 s (même ordre, mêmes suffixes).
 * Refus : horodatage futur, lot qui ne serait pas STRICTEMENT postérieur à toutes les migrations hors lot, noms invalides.
 */
export function planRename({ batch, others, base, now = new Date() }) {
  assert.ok(batch.length > 0, "Lot vide");
  assert.deepEqual([...batch], [...batch].sort(), "Le lot doit être dans l'ordre d'application (tri par nom)");
  const baseDate = parseTimestamp(base);
  const last = new Date(baseDate.getTime() + (batch.length - 1) * 1000);
  assert.ok(
    last.getTime() <= now.getTime() + CLOCK_TOLERANCE_MS,
    `Horodatage futur refusé (${formatTimestamp(last)} > maintenant ${formatTimestamp(now)}) : utiliser l'horodatage réel du moment du renommage`,
  );
  const maxOther = [...others].map(timestampOf).sort().pop();
  if (maxOther !== undefined) {
    assert.ok(
      base > maxOther,
      `Le lot doit être postérieur à TOUTES les autres migrations (la plus récente : ${maxOther}) ; base ${base}. Une migration déjà datée dans le futur par une autre PR bloque : décision du propriétaire requise`,
    );
  }
  const mapping = batch.map((from, index) => ({
    from,
    to: `${formatTimestamp(new Date(baseDate.getTime() + index * 1000))}_${suffixOf(from)}`,
  }));
  assert.equal(new Set(mapping.map((m) => m.to)).size, mapping.length, "Noms cibles en double");
  assert.deepEqual(mapping.map((m) => m.to), mapping.map((m) => m.to).sort(), "L'ordre d'application doit être conservé");
  return mapping;
}

/** Vrai si tout le lot est strictement postérieur à toutes les autres migrations. */
export function isBatchAfterOthers(batch, others) {
  const maxOther = [...others].map(timestampOf).sort().pop();
  return maxOther === undefined || batch.every((name) => timestampOf(name) > maxOther);
}

export function replaceNames(text, mapping) {
  let out = text;
  for (const { from, to } of [...mapping].sort((a, b) => b.from.length - a.from.length)) out = out.split(from).join(to);
  return out;
}

export function isRewritable(path) {
  return !NEVER_REWRITE_PREFIXES.some((prefix) => path.startsWith(prefix)) && !HISTORICAL_DOCS.includes(path) && !FIXTURE_FILES.includes(path);
}

/** Table de correspondance consignée dans docs/LIVRAISON-XP.md au moment du renommage. */
export function renderMappingSection(mapping, dateIso) {
  const rows = mapping.map((m) => `| \`${m.from}\` | \`${m.to}\` |`).join("\n");
  return `\n## 9. Renommage des migrations du lot (${dateIso})\n\nLes 6 migrations ont été renommées avec l'horodatage réel du moment (postérieur à toutes les autres migrations ; contenu SQL inchangé, empreinte vérifiée). Les documents historiques de répétition (\`docs/XP-ROLLOUT-DECISION-20261019.md\`, \`docs/XP-BALANCE-20261019.md\`, \`docs/XP-REPETITION-COMPLETE.md\`, \`docs/XP-ROLE-BARRIER-REHEARSAL.md\`, \`docs/MISSION-20261019.md\`) gardent les anciens noms : ils décrivent des répétitions faites avant le renommage.\n\n| Ancien nom | Nouveau nom |\n|---|---|\n${rows}\n\nUne base (recette, Preview, répétition) où un ancien nom a été appliqué doit être recréée, ou ses lignes \`_prisma_migrations\` réconciliées sous accord séparé (le checksum est identique).\n`;
}
