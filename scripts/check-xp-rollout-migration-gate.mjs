import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import {
  assertExpectedMatchesDerived, assertOnlyExpectedXpMigrationPending, assertRolloutMigrationsPending, deriveRolloutMigrations,
  EXPECTED_ROLLOUT_MIGRATIONS, EXPECTED_XP_MIGRATION, EXPECTED_XP_MIGRATIONS,
} from "./xp-rollout-migration-gate.mjs";

// --- Autotest pur (lot complet) ---
const E = EXPECTED_ROLLOUT_MIGRATIONS;
const applied = ["20261018120000_previous_change"];
assert.deepEqual(assertRolloutMigrationsPending([...applied, ...E], applied), E);
assert.deepEqual(assertRolloutMigrationsPending([...applied, ...E], [...applied, ...E.slice(0, 3)]), E.slice(3));
assert.throws(() => assertRolloutMigrationsPending([...applied, ...E], [...applied, E[2]]), /lot complet attendu/); // non contigu
assert.throws(() => assertRolloutMigrationsPending([...applied, ...E.slice(0, 2)], applied), /lot complet attendu/); // manquante
assert.throws(() => assertRolloutMigrationsPending([...applied, ...E, "20261023120000_unexpected"], applied), /lot complet attendu/); // en trop
assert.throws(() => assertRolloutMigrationsPending([...applied, ...E], applied, { expected: [...E].reverse() }), /ordre d'application/); // ordre inversé
assert.throws(() => assertRolloutMigrationsPending([...applied, ...E], [...applied, ...E.slice(0, 1)], { unfinished: [E[1]] }), /inachevée/);
assert.throws(() => assertRolloutMigrationsPending([...applied, ...E], [...applied, "20261017120000_removed"]), /absentes du checkout/);

// --- Garde historique à 2 migrations (conservé pour rehearse-xp-role-barrier.mjs) ---
const available = [...applied, EXPECTED_XP_MIGRATION];
assert.deepEqual(assertOnlyExpectedXpMigrationPending([...applied, ...EXPECTED_XP_MIGRATIONS], applied), EXPECTED_XP_MIGRATIONS);
assert.throws(() => assertOnlyExpectedXpMigrationPending([...available, "20261020120000_unexpected"], applied), /seule migration attendue/);

// --- Vérification contre le dépôt : la liste attendue = checkout moins origin/main ---
const names = (text) => text.split("\n").map((l) => l.trim().replace(/\/$/, "").split("/").pop()).filter(Boolean);
const checkout = readdirSync("prisma/migrations", { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(`prisma/migrations/${e.name}/migration.sql`)).map((e) => e.name);
const ref = process.env.XP_GATE_REF ?? "origin/main";
const tree = spawnSync("git", ["ls-tree", "-d", "--name-only", ref, "prisma/migrations/"], { encoding: "utf8" });
if (tree.status !== 0) {
  console.log(`OK autotest du garde ; vérification contre ${ref} IGNORÉE (ref absente : ${tree.stderr.trim()})`);
} else {
  const derived = deriveRolloutMigrations(checkout, names(tree.stdout));
  assertExpectedMatchesDerived(E, derived);
  console.log(`OK XP migration gate: lot complet de ${E.length} migrations = checkout moins ${ref}`);
}
