import { checkHistory } from '../neon-test/apply-policy.mjs';

export const first = '20261104140000_tower_team_membership_policy';
export const second = '20261105120000_tower_launch_channels_appeals_matchmaking';
export const arbiter = '20261106150000_tower_fixed_arbiter';
export const additions = Object.freeze({
  [first]: '9f642e6200bef888669e9c058bf1623ad582cd2772ea5e433a7b78bfa596db8f',
  [second]: 'e7782519fcdf5e9637f131fbd348ceb07c8f6f177dbe87f82ba9a18f6c94a9de',
  [arbiter]: '3c91bd363a602513359106769863224b954cb596b96894258c0d924898b9faf3',
});
export function authorize(env, args = []) {
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('NEON_TEST_MAIN_REQUIRED');
  if (args.length || env.OPERATION !== 'validate' || env.CONFIRMATION || env.APPLY_AUTHORIZATION) throw new Error('NEON_TEST_ARBITER_READ_ONLY');
}
export function predecessors(baseline) {
  const names = Object.keys(baseline).sort();
  if (names.length !== 118 || names.some(name => name >= first)) throw new Error('NEON_TEST_ARBITER_BASELINE');
  return { ...baseline, [first]: additions[first], [second]: additions[second] };
}
export function requirePredecessors(history, baseline) {
  const expected = predecessors(baseline);
  if (history.length !== 120) throw new Error('NEON_TEST_ARBITER_PREDECESSORS_REQUIRED');
  checkHistory(history, expected);
}
// No caller-controlled runner arguments or execute option.
export async function validateOnly({ history, baseline, check, run }) {
  requirePredecessors(await history(), baseline);
  await check();
  await run(['scripts/db-migrate.mjs', `--expect=${arbiter}`]);
}

export function requireSequenceUsage(allowed) {
  if (allowed !== true) throw new Error('NEON_TEST_ARBITER_SEQUENCE_PRIVILEGES');
}
