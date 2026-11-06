// Répétition explicite uniquement sur une base PostgreSQL FICTIVE locale dédiée.
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readState, checkSnapshot } from './state.mjs';
import { checkHistory } from './apply-policy.mjs';

const require = createRequire(import.meta.url);
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? '');
  const database = url.pathname.slice(1);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.search !== '' || !/^gamenight_apply_rehearsal_[a-z0-9_]+$/.test(database)) throw Error('LOCAL_REHEARSAL_TARGET_REFUSED');
  const role = decodeURIComponent(url.username);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({datasourceUrl:url.href});
  const schemas = JSON.parse(readFileSync(new URL('./schemas.json',import.meta.url),'utf8'));
  const expected = JSON.parse(readFileSync(new URL('./baseline.json',import.meta.url),'utf8'));
  const operator = mkdtempSync(join(tmpdir(),'gamenight-apply-rehearsal-'));
  mkdirSync(join(operator,'prisma'));
  mkdirSync(join(operator,'scripts'));
  cpSync('prisma/migrations',join(operator,'prisma/migrations'),{recursive:true});
  cpSync('prisma/schema.prisma',join(operator,'prisma/schema.prisma'));
  cpSync('package.json',join(operator,'package.json'));
  symlinkSync(join(process.cwd(),'node_modules'),join(operator,'node_modules'));
  for (const name of ['db-migrate.mjs','db-migrate-lib.mjs']) writeFileSync(join(operator,'scripts',name),execFileSync('git',['show','4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb:scripts/'+name]));
  const verifyLocal = identity => {
    if (identity.db !== database || identity.role !== role || identity.project || identity.branch || identity.ssl !== false) throw Error('LOCAL_REHEARSAL_IDENTITY_REFUSED');
  };
  try {
    let state = await readState(db,role,verifyLocal);
    checkHistory(state.history,expected);
    checkSnapshot(state,118,schemas[118]);
    const before = state.data;
    const migrations = [
      ['20261104140000_tower_team_membership_policy','4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb'],
      ['20261105120000_tower_launch_channels_appeals_matchmaking','1a495ede501784167b597c43438c1527b2d58082'],
    ];
    for (let i=0;i<migrations.length;i++) {
      const [name,ref] = migrations[i];
      const sql = execFileSync('git',['show',ref+':prisma/migrations/'+name+'/migration.sql']);
      expected[name] = createHash('sha256').update(sql).digest('hex');
      const dir = join(operator,'prisma/migrations',name);mkdirSync(dir);writeFileSync(join(dir,'migration.sql'),sql);
      const env = {...process.env,MIGRATION_DATABASE_URL:url.href};
      delete env.DATABASE_URL;delete env.TEST_DATABASE_URL;delete env.GAMENIGHT_RUNTIME_ROLE;
      for (const execute of [false,true]) execFileSync(process.execPath,['scripts/db-migrate.mjs',`--expect=${name}`,'--allow-local',...(execute?['--execute',`--confirm-database=${database}`]:[])],{cwd:operator,env,stdio:'pipe'});
      state = await readState(db,role,verifyLocal);
      checkHistory(state.history,expected);
      checkSnapshot(state,119+i,schemas[119+i],before);
      console.log(`Répétition fictive locale : phase${119+i}, historique/checksums/schéma/données/backfill/DML vérifiés.`);
    }
  } finally { await db.$disconnect(); }
}
main().catch(() => {console.error('LOCAL_REHEARSAL_REFUSED_OR_FAILED');process.exitCode=2;});
