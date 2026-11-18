import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { authorize } from './apply-policy.mjs';

export async function verifyProof(env, get = async path => {
  const response = await fetch('https://api.github.com/repos/ZeyFro/gamenight/' + path, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error('NEON_TEST_GITHUB_PROOF_UNAVAILABLE');
  return response.json();
}) {
  authorize({ operation: env.OPERATION, ref: env.GITHUB_REF, activation: env.APPLY_AUTHORIZATION, confirmation: env.CONFIRMATION, evidence: env.RESTORATION_EVIDENCE });
  if (env.GITHUB_REPOSITORY !== 'ZeyFro/gamenight' || !/^[1-9][0-9]*$/.test(env.DRY_RUN_ID ?? '')) throw new Error('NEON_TEST_WRONG_RUN');
  const fresh = date => { const age = Date.now() - Date.parse(date); return Number.isFinite(age) && age >= 0 && age <= 86400000; };
  const run = await get('actions/runs/' + env.DRY_RUN_ID);
  if (run.conclusion !== 'success' || run.event !== 'workflow_dispatch' || run.head_branch !== 'main'
    || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')
    || run.path !== '.github/workflows/neon-test-migrations.yml' || !fresh(run.updated_at)) throw new Error('NEON_TEST_DRY_RUN_NOT_VALIDATED');
  const approved = JSON.parse(readFileSync(new URL('./approved-sources.json', import.meta.url),'utf8'));
  for (const [path,expected] of Object.entries(approved)) {
    const source = await get('contents/' + path + '?ref=' + run.head_sha);
    if (source.encoding !== 'base64' || createHash('sha256').update(Buffer.from(source.content, 'base64')).digest('hex') !== expected) throw new Error('NEON_TEST_DRY_RUN_SOURCE_CHANGED');
  }
  if (env.OPERATION === 'apply') {
    const id = env.RESTORATION_EVIDENCE.split('issuecomment-')[1];
    const comment = await get('issues/comments/' + id);
    const required = { RESTORATION_TEST_VALIDATED: 'true', BACKUP_READY: 'true', APPLY_TEST_370_406_APPROVED: 'true', BACKUP_BRANCH: 'br-purple-mud-b1nt0tfi', TARGET_BRANCH: 'br-snowy-snow-b1cggq2w' };
    const lines = (comment.body ?? '').split(/\r?\n/).map(line => line.trim());
    const valid = Object.entries(required).every(([key,value]) => {
      const matches = lines.filter(line => line.startsWith(key + '='));
      return matches.length === 1 && matches[0] === key + '=' + value;
    });
    if (comment.user?.login !== 'ZeyFro' || !comment.issue_url?.endsWith('/issues/400') || !fresh(comment.updated_at) || !valid) throw new Error('NEON_TEST_RESTORATION_NOT_VALIDATED');
  }
}
