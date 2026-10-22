import assert from "node:assert/strict";

export const EXPECTED_XP_MIGRATION = "20261019190000_separate_xp_balance";

export function assertOnlyExpectedXpMigrationPending(availableMigrations, appliedMigrations) {
  const available = [...new Set(availableMigrations)].sort();
  const applied = [...new Set(appliedMigrations)].sort();
  const absentFromCheckout = applied.filter((name) => !available.includes(name));
  assert.deepEqual(absentFromCheckout, [], "L’historique Prisma contient des migrations absentes du checkout");

  const pending = available.filter((name) => !applied.includes(name));
  assert.deepEqual(pending, [EXPECTED_XP_MIGRATION], "La seule migration attendue doit être en attente");
  return pending;
}
