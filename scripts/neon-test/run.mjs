import { readFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { authorize, checkHistoryWithDiagnostics, sequence } from './apply-policy.mjs';
import { matchesMigrationChecksum } from './historical-checksums.mjs';
import { readState, checkSnapshot, schemaForServer, loadForeignTables, checkForeignTables } from './state.mjs';
import { strictNativeConnection } from './native-tls.mjs';
import { validateConnectionRoles, validateTestIdentity } from '../neon-test-preflight.mjs';
import { assertTarget, assertSingleUrlSource } from '../db-migrate-lib.mjs';

const first = '20261104140000_tower_team_membership_policy';
const second = '20261105120000_tower_launch_channels_appeals_matchmaking';
const sqlHashes = {
  [first]: '9f642e6200bef888669e9c058bf1623ad582cd2772ea5e433a7b78bfa596db8f',
  [second]: 'e7782519fcdf5e9637f131fbd348ceb07c8f6f177dbe87f82ba9a18f6c94a9de',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));
const schemas = JSON.parse(readFileSync(new URL('./schemas.json', import.meta.url), 'utf8'));
const foreignTables = loadForeignTables();

export function verifyFiles(expected) {
  const approved = JSON.parse(readFileSync(new URL('./approved-sources.json',import.meta.url),'utf8'));
  for (const [path,hash] of Object.entries(approved)) if (sha(readFileSync(path)) !== hash) throw new Error('NEON_TEST_APPROVED_SOURCE_CHANGED');
  const dirs = readdirSync('prisma/migrations', {withFileTypes:true}).filter(d => d.isDirectory()).map(d => d.name).sort();
  if (JSON.stringify(dirs) !== JSON.stringify(Object.keys(expected).sort())) throw new Error('NEON_TEST_UNEXPECTED_MIGRATION_FILES');
  for (const name of dirs) if (sha(readFileSync(`prisma/migrations/${name}/migration.sql`)) !== expected[name]) throw new Error('NEON_TEST_SQL_CHECKSUM');
}

async function main() {
  const env = { ...process.env };
  authorize({operation:env.OPERATION,ref:env.GITHUB_REF,activation:env.APPLY_AUTHORIZATION,confirmation:env.CONFIRMATION,evidence:env.RESTORATION_EVIDENCE});
  // La preuve GitHub est vérifiée de nouveau juste avant l'accès base.
  await (await import('./proof.mjs')).verifyProof(env);
  assertSingleUrlSource(env);
  const roles = validateConnectionRoles(env.MIGRATION_DATABASE_URL,env.GAMENIGHT_RUNTIME_ROLE,env.GAMENIGHT_MIGRATION_ROLE);
  if (roles.migrationRole !== 'gamenight_test_migrator') throw new Error('NEON_TEST_WRONG_MIGRATOR');
  assertTarget({migrationUrl:env.MIGRATION_DATABASE_URL,runtimeRole:roles.runtimeRole,expectedTarget:env.GAMENIGHT_EXPECTED_TARGET,execute:env.OPERATION==='apply'});
  // Un seul canal natif strict, transmis aussi au préflight/runner/CLI Prisma.
  // pg_stat_ssl décrit le backend derrière le proxy Neon, pas ce canal client.
  env.MIGRATION_DATABASE_URL = strictNativeConnection(env.MIGRATION_DATABASE_URL);
  const {PrismaClient} = await import('@prisma/client');
  const db = new PrismaClient({datasourceUrl:env.MIGRATION_DATABASE_URL});
  let secondAdded = false;
  let originalData;
  const invoke = args => {
    const result = spawnSync(process.execPath,args,{env,stdio:'inherit'});
    if (result.error || result.status !== 0) throw new Error('NEON_TEST_RUNNER_STOPPED');
  };
  try {
    await sequence(env.OPERATION, {
      check: async phase => {
        verifyFiles({...baseline,[first]:sqlHashes[first],...(secondAdded?{[second]:sqlHashes[second]}:{})});
        invoke(['scripts/neon-test-preflight.mjs']);
        const state = await readState(db,roles.runtimeRole,identity => {
          validateTestIdentity(identity,roles);
        },foreignTables);
        const expectedHistory = {...baseline,...(phase>=119?{[first]:sqlHashes[first]}:{}),...(phase>=120?{[second]:sqlHashes[second]}:{})};
        checkHistoryWithDiagnostics(state.history,expectedHistory, diagnostic => console.error(`NEON_TEST_HISTORY_DIAGNOSTICS ${JSON.stringify(diagnostic)}`));
        for (const row of state.history) if (row.checksum !== expectedHistory[row.migration_name] && matchesMigrationChecksum(row.migration_name,row.checksum,expectedHistory[row.migration_name])) console.log(`Historique CRLF reconnu, SQL scellé inchangé : ${row.migration_name}`);
        checkSnapshot(state,phase,schemaForServer(state.identity.version,phase,schemas),originalData,foreignTables);
        originalData ??= state.data;
        console.log(`Phase ${phase} : identité/TLS, historique/checksums, schéma, données et droits runtime vérifiés.`);
        for (const known of checkForeignTables(state,foreignTables)) console.log(`Table étrangère déclarée et conforme (non gérée par les migrations, jamais modifiée) : ${known.table} ${known.digest}`);
      },
      run: async (phase,execute) => invoke(['scripts/db-migrate.mjs',`--expect=${phase===119?first:second}`,...(execute?['--execute','--confirm-database=neondb']:[])]),
      addSecond: async () => {
        const source = `../migration-406/prisma/migrations/${second}/migration.sql`;
        if (sha(readFileSync(source)) !== sqlHashes[second]) throw new Error('NEON_TEST_SECOND_SQL_CHECKSUM');
        mkdirSync(`prisma/migrations/${second}`);
        copyFileSync(source,`prisma/migrations/${second}/migration.sql`);
        secondAdded = true;
      },
    });
  } finally { await db.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(/^NEON_TEST_[A-Z_]+$/.test(error?.message??'')?error.message:'NEON_TEST_OPERATION_REFUSED'); process.exitCode=2; });
}
