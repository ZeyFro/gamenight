import assert from "node:assert/strict";

// Ordre d'application. Production n'a ni l'une ni l'autre ; une base déjà
// passée par la première n'attend plus que la seconde.
export const EXPECTED_XP_MIGRATIONS = [
  "20261019190000_separate_xp_balance",
  "20261022142500_shop_balance_purchase_reason",
];
export const EXPECTED_XP_MIGRATION = EXPECTED_XP_MIGRATIONS[0];

export function assertOnlyExpectedXpMigrationPending(availableMigrations, appliedMigrations) {
  const available = [...new Set(availableMigrations)].sort();
  const applied = [...new Set(appliedMigrations)].sort();
  const absentFromCheckout = applied.filter((name) => !available.includes(name));
  assert.deepEqual(absentFromCheckout, [], "L’historique Prisma contient des migrations absentes du checkout");

  const pending = available.filter((name) => !applied.includes(name));
  const accepted = EXPECTED_XP_MIGRATIONS.map((_, index) => EXPECTED_XP_MIGRATIONS.slice(index));
  assert.ok(
    accepted.some((suffix) => suffix.length === pending.length && suffix.every((name, i) => name === pending[i])),
    `La seule migration attendue (ou les deux migrations XP, dans l'ordre) doit être en attente : ${pending.join(", ") || "aucune"}`,
  );
  return pending;
}

// Lot COMPLET attendu pour la mise en ligne (ordre d'application = ordre des noms) : les 2 migrations XP
// et les 4 migrations vocales, toutes absentes de origin/main. `prisma migrate deploy` applique le lot
// entier ; le code déployé lit aussi les tables vocales : migrer seulement le XP casserait ces pages.
// Cette liste est vérifiable : `node scripts/check-xp-rollout-migration-gate.mjs` la compare à
// « migrations du checkout absentes de origin/main » (deriveRolloutMigrations).
export const EXPECTED_ROLLOUT_MIGRATIONS = [
  "20261019190000_separate_xp_balance",
  "20261020150000_session_voice_presence",
  "20261022120000_voice_presence_consent_coordination",
  "20261022130000_voice_presence_retention_gap_bounds",
  "20261022140000_voice_presence_gap_history",
  "20261022142500_shop_balance_purchase_reason",
];

/** Migrations du checkout absentes de la référence (ex. origin/main), triées : le lot à appliquer. */
export function deriveRolloutMigrations(checkoutMigrations, refMigrations) {
  const ref = new Set(refMigrations);
  return [...new Set(checkoutMigrations)].filter((name) => !ref.has(name)).sort();
}

/** La liste attendue doit être triée, sans doublon, et égale au lot déduit du dépôt. */
export function assertExpectedMatchesDerived(expected, derived) {
  assert.deepEqual([...expected], [...expected].sort(), "La liste attendue doit être dans l'ordre d'application (tri par nom)");
  assert.equal(new Set(expected).size, expected.length, "La liste attendue contient un doublon");
  assert.deepEqual([...expected], derived, "La liste attendue diffère des migrations du checkout absentes de la référence");
  return expected;
}

/**
 * Garde du lot complet. Accepte l'état « rien d'appliqué » (le lot entier) ou une reprise partielle
 * (suffixe du lot, dans l'ordre). Refuse : migration inachevée, historique absent du checkout,
 * migration inattendue en attente, migration manquante, ordre différent, lot non contigu.
 */
export function assertRolloutMigrationsPending(availableMigrations, appliedMigrations, { expected = EXPECTED_ROLLOUT_MIGRATIONS, unfinished = /** @type {string[]} */ ([]) } = {}) {
  assert.deepEqual([...unfinished], [], `Migration inachevée ou en échec : ${[...unfinished].join(", ")}`);
  assert.deepEqual([...expected], [...expected].sort(), "La liste attendue doit être dans l'ordre d'application");
  const available = [...new Set(availableMigrations)].sort();
  const applied = [...new Set(appliedMigrations)].sort();
  const absentFromCheckout = applied.filter((name) => !available.includes(name));
  assert.deepEqual(absentFromCheckout, [], "L’historique Prisma contient des migrations absentes du checkout");

  const pending = available.filter((name) => !applied.includes(name));
  const accepted = expected.map((_, index) => expected.slice(index));
  assert.ok(
    accepted.some((suffix) => suffix.length === pending.length && suffix.every((name, i) => name === pending[i])),
    `Le lot complet attendu (ou sa suite, dans l'ordre) doit être en attente : attendu [${expected.join(", ")}], en attente [${pending.join(", ") || "aucune"}]`,
  );
  return pending;
}
