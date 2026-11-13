import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { authorize, additions, predecessors, requireSequenceUsage, requirePredecessors, validateOnly } from './policy.mjs';
import { verifyFiles } from '../neon-test/run.mjs';
import { readState, checkSnapshot, schemaForServer, loadForeignTables } from '../neon-test/state.mjs';
import { strictNativeConnection } from '../neon-test/native-tls.mjs';
import { validateConnectionRoles, validateTestIdentity } from '../neon-test-preflight.mjs';
import { assertSingleUrlSource, assertTarget } from '../db-migrate-lib.mjs';

async function main() {
  const env = { ...process.env };
  authorize(env, process.argv.slice(2));
  const baseline = JSON.parse(readFileSync(new URL('../neon-test/baseline.json', import.meta.url), 'utf8'));
  const schemas = JSON.parse(readFileSync(new URL('../neon-test/schemas.json', import.meta.url), 'utf8'));
  const foreignTables = loadForeignTables();
  predecessors(baseline);
  verifyFiles({ ...baseline, ...additions });
  assertSingleUrlSource(env);
  const roles = validateConnectionRoles(env.MIGRATION_DATABASE_URL, env.GAMENIGHT_RUNTIME_ROLE, env.GAMENIGHT_MIGRATION_ROLE);
  if (roles.migrationRole !== 'gamenight_test_migrator') throw new Error('NEON_TEST_WRONG_MIGRATOR');
  assertTarget({ migrationUrl: env.MIGRATION_DATABASE_URL, runtimeRole: roles.runtimeRole, expectedTarget: env.GAMENIGHT_EXPECTED_TARGET, execute: false });
  env.MIGRATION_DATABASE_URL = strictNativeConnection(env.MIGRATION_DATABASE_URL);
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: env.MIGRATION_DATABASE_URL });
  const invoke = args => {
    const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('NEON_TEST_RUNNER_STOPPED');
  };
  try {
    await validateOnly({
      baseline,
      history: () => db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS db,current_user AS role,current_setting('neon.project_id',true) AS project,current_setting('neon.branch_id',true) AS branch");
        validateTestIdentity(identity, roles);
        return tx.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name');
      }),
      check: async () => {
        invoke(['scripts/neon-test-preflight.mjs']);
        const state = await readState(db, roles.runtimeRole, identity => validateTestIdentity(identity, roles), foreignTables);
        // Re-check history in the same snapshot used for the schema/data validation.
        requirePredecessors(state.history, baseline);
        checkSnapshot(state, 120, schemaForServer(state.identity.version, 120, schemas), undefined, foreignTables);
        // BIGSERIAL will need sequence USAGE for the separate application role.
        // Catalog-only check, no nextval(), CREATE or GRANT probe.
        const [defaults] = await db.$queryRawUnsafe("SELECT EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND d.defaclnamespace IN (0,'public'::regnamespace) AND d.defaclobjtype='S' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1) AND a.privilege_type='USAGE') AS allowed", roles.runtimeRole);
        requireSequenceUsage(defaults.allowed);
        console.log('Phase 120 : identité native/TLS, historique, schéma, données initiales, rôles et droits vérifiés.');
      },
      run: invoke,
    });
    console.log('Validation arbitre terminée : dry-run uniquement, aucune migration appliquée.');
  } finally { await db.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(/^NEON_TEST_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'NEON_TEST_ARBITER_REFUSED');
    process.exitCode = 2;
  });
}
