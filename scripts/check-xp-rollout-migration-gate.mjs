import assert from "node:assert/strict";
import { assertOnlyExpectedXpMigrationPending, EXPECTED_XP_MIGRATION, EXPECTED_XP_MIGRATIONS } from "./xp-rollout-migration-gate.mjs";

const expected = EXPECTED_XP_MIGRATION;
const applied = ["20261018120000_previous_change"];
const available = [...applied, expected];

assert.deepEqual(assertOnlyExpectedXpMigrationPending([...applied, ...EXPECTED_XP_MIGRATIONS], applied), EXPECTED_XP_MIGRATIONS);
assert.deepEqual(assertOnlyExpectedXpMigrationPending([...applied, ...EXPECTED_XP_MIGRATIONS], [...applied, expected]), [EXPECTED_XP_MIGRATIONS[1]]);
assert.throws(() => assertOnlyExpectedXpMigrationPending([...applied, ...EXPECTED_XP_MIGRATIONS], [...applied, EXPECTED_XP_MIGRATIONS[1]]), /seule migration attendue/);
assert.throws(() => assertOnlyExpectedXpMigrationPending([...applied, expected], [...applied, expected]), /seule migration attendue/);
assert.throws(() => assertOnlyExpectedXpMigrationPending([...available, "20261020120000_unexpected"], applied), /seule migration attendue/);
assert.throws(() => assertOnlyExpectedXpMigrationPending(available, [...applied, "20261017120000_removed"]), /absentes du checkout/);

console.log("OK XP migration gate: single expected pending migration and consistent history");
