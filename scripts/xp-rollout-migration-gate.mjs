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
