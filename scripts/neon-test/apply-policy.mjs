// Politique pure : aucun accès réseau, secret ou écriture SQL.
/** @param {{operation: string, ref: string, activation?: string, confirmation?: string, evidence?: string}} config */
export function authorize({ operation, ref, activation, confirmation, evidence }) {
  if (ref !== 'refs/heads/main') throw new Error('NEON_TEST_MAIN_REQUIRED');
  if (!['validate', 'apply'].includes(operation)) throw new Error('NEON_TEST_UNKNOWN_OPERATION');
  if (operation === 'validate') return;
  if (activation !== '370-406-test-only' || confirmation !== 'APPLY-370-406-ON-TEST') throw new Error('NEON_TEST_APPLICATION_NOT_AUTHORIZED');
  if (!/^https:\/\/github\.com\/ZeyFro\/gamenight\/issues\/400#issuecomment-[1-9][0-9]*$/.test(evidence ?? '')) throw new Error('NEON_TEST_RESTORATION_EVIDENCE_REQUIRED');
}

export function checkHistory(rows, expected) {
  if (rows.length !== Object.keys(expected).length) throw new Error('NEON_TEST_HISTORY_COUNT');
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.migration_name) || !Object.hasOwn(expected, row.migration_name)
      || expected[row.migration_name] !== row.checksum || !row.finished_at || row.rolled_back_at) throw new Error('NEON_TEST_HISTORY_MISMATCH');
    seen.add(row.migration_name);
  }
}

// Le runner applique tous les dossiers présents. Le callback addSecond ne doit
// donc jamais précéder le contrôle réussi après la première migration.
export async function sequence(operation, { check, run, addSecond }) {
  if (!['validate', 'apply'].includes(operation)) throw new Error('NEON_TEST_UNKNOWN_OPERATION');
  await check(118);
  await run(119, false);
  if (operation === 'validate') return;
  await check(118);
  await run(119, true);
  await check(119);
  await addSecond();
  await run(120, false);
  await check(119);
  await run(120, true);
  await check(120);
}
