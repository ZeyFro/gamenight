import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const changedColumns = {
  Membership: ['lastTeamLeftAt'],
  CommunityTeam: ['captainId', 'captainLastActivityAt'],
  CommunityTeamMember: [],
  TowerChallengeAttempt: ['proofCode', 'rejectedAt', 'staffReportedAt', 'archivedAt'],
  PlayerClassified: ['startsAt', 'durationMinutes', 'partyType', 'platform', 'microphoneRequirement'],
};
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Tables étrangères CONNUES : présentes sur Neon Test mais absentes de nos migrations (ex. table d'exemple de la console Neon).
// Elles sont déclarées une à une dans foreign-tables.json avec le condensé de leurs colonnes, contraintes et index (par version
// majeure) : exclues du condensé du schéma géré, mais jamais ignorées (condensé épinglé, absence refusée, aucun lien de clé
// étrangère avec une table gérée). Toute autre table inconnue reste une divergence NEON_TEST_SCHEMA_MISMATCH. Aucune donnée lue.
export function loadForeignTables() {
  return JSON.parse(readFileSync(new URL('./foreign-tables.json', import.meta.url), 'utf8'));
}
// Représentation canonique (chaînes) : le condensé ne dépend ni du pilote (Prisma, node-postgres, HTTP) ni des types JS renvoyés.
const text = value => (value === null || value === undefined ? '' : String(value));
export function foreignDigest(rows) {
  return digest({
    columns: rows.columns.map(r => [r.relname, r.attname, r.type, text(r.atttypmod), text(r.attnotnull), text(r.def)]),
    constraints: rows.constraints.map(r => [r.relname, r.conname, text(r.contype), text(r.convalidated), text(r.conenforced), text(r.def)]),
    indexes: rows.indexes.map(r => [r.table_name, r.name, text(r.indisvalid), text(r.indisready), text(r.def)]),
  });
}
export function splitForeign(rows, foreignTables) {
  const names = new Set(Object.keys(foreignTables));
  const managed = key => row => !names.has(row[key]);
  return {
    managed: {
      columns: rows.columns.filter(managed('relname')),
      constraints: rows.constraints.filter(managed('relname')),
      indexes: rows.indexes.filter(managed('table_name')),
    },
    foreign: Object.fromEntries([...names].sort().map(name => [name, {
      columns: rows.columns.filter(r => r.relname === name),
      constraints: rows.constraints.filter(r => r.relname === name),
      indexes: rows.indexes.filter(r => r.table_name === name),
    }])),
  };
}
export function checkForeignTables(state, foreignTables, managedTables = Object.keys(changedColumns)) {
  const declared = Object.keys(foreignTables);
  if (declared.length === 0) return [];
  const major = Math.floor(state.identity.version / 10000);
  for (const name of declared) {
    if (managedTables.includes(name)) throw new Error('NEON_TEST_FOREIGN_TABLE');           // déclaration en conflit avec une table gérée
    const pinned = foreignTables[name]?.digests?.[major];
    const seen = state.foreign?.[name];
    if (typeof pinned !== 'string' || typeof seen !== 'string') throw new Error('NEON_TEST_FOREIGN_TABLE'); // non épinglée pour cette version, ou absente
    if (pinned !== seen) throw new Error('NEON_TEST_FOREIGN_TABLE');                        // modifiée : colonne, contrainte ou index en plus ou en moins
  }
  if (state.foreignLinks?.length) throw new Error('NEON_TEST_FOREIGN_TABLE');              // clé étrangère entre table étrangère et table gérée
  return declared.map(name => ({ table: name, digest: state.foreign[name] }));
}
export function schemaForServer(version, phase, manifests) {
  const major = Math.floor(version / 10000);
  if (![16, 18].includes(major)) throw new Error('NEON_TEST_SERVER_VERSION');
  const expected = manifests[major]?.[phase];
  if (typeof expected !== 'string') throw new Error('NEON_TEST_SCHEMA_PHASE');
  return expected;
}
export function checkSnapshot(state, phase, expectedSchema, before, foreignTables = {}) {
  if (state.schema !== expectedSchema) throw new Error('NEON_TEST_SCHEMA_MISMATCH');
  checkForeignTables(state, foreignTables);
  if (before && JSON.stringify(state.data) !== JSON.stringify(before)) throw new Error('NEON_TEST_DATA_CHANGED');
  if (!state.runtimeDml) throw new Error('NEON_TEST_RUNTIME_PRIVILEGES');
  if (phase >= 119 && state.teamBackfillInvalid !== 0) throw new Error('NEON_TEST_TEAM_BACKFILL');
  if (phase >= 120 && state.newValues !== 0) throw new Error('NEON_TEST_NEW_DATA');
}

// Retourne seulement métadonnées, compteurs et empreintes : aucune ligne métier.
export async function readState(db, runtimeRole, verifyIdentity, foreignTables = {}) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL search_path = public, pg_catalog");
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS db,current_user AS role,current_setting('neon.project_id',true) AS project,current_setting('neon.branch_id',true) AS branch,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,current_setting('server_version_num')::int AS version");
    verifyIdentity(identity);
    const major = Math.floor(identity.version / 10000);
    if (![16, 18].includes(major)) throw new Error('NEON_TEST_SERVER_VERSION');
    const history = await tx.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name');
    const columns = await tx.$queryRawUnsafe("SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,a.atttypmod,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS def FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum");
    const constraints = await tx.$queryRawUnsafe(`SELECT c.relname,k.conname,k.contype,k.convalidated,${major === 18 ? 'k.conenforced,' : ''}pg_get_constraintdef(k.oid,true) AS def FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname`);
    const indexes = await tx.$queryRawUnsafe("SELECT c.relname AS table_name,i.relname AS name,x.indisvalid,x.indisready,pg_get_indexdef(i.oid) AS def FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,i.relname");
    const enums = await tx.$queryRawUnsafe("SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder");
    const declared = Object.keys(foreignTables);
    const split = splitForeign({ columns, constraints, indexes }, foreignTables);
    const foreign = {};
    for (const name of declared) {
      const rows = split.foreign[name];
      if (rows.columns.length) foreign[name] = foreignDigest(rows);
    }
    // Lien de clé étrangère entre une table étrangère déclarée et une autre table (dans un sens ou dans l'autre) : refusé par checkSnapshot.
    const foreignLinks = declared.length
      ? await tx.$queryRawUnsafe("SELECT conname FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND k.contype='f' AND ((k.conrelid::regclass::text = ANY($1::text[])) <> (k.confrelid::regclass::text = ANY($1::text[]))) ORDER BY conname", declared)
      : [];
    const data = {};
    for (const [table, omitted] of Object.entries(changedColumns)) {
      const expression = 'to_jsonb(t)' + omitted.map(name => ` - '${name}'`).join('');
      const [value] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count,md5(COALESCE(string_agg((${expression})::text,E'\\n' ORDER BY (${expression})::text),'')) AS hash FROM "${table}" t`);
      data[table] = value;
    }
    const phase = history.length;
    const tables = [...Object.keys(changedColumns), ...(phase >= 120 ? ['TowerChallengeAppeal','UserNotificationChannelPreference'] : [])];
    let runtimeDml = true;
    for (const table of tables) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
      const [r] = await tx.$queryRawUnsafe('SELECT has_table_privilege($1,$2,$3) AS allowed',runtimeRole,`public."${table}"`,privilege);
      if (!r.allowed) runtimeDml = false;
    }
    let teamBackfillInvalid = 0;
    if (phase >= 119) {
      const [r] = await tx.$queryRawUnsafe('SELECT (SELECT count(*) FROM "Membership" WHERE "lastTeamLeftAt" IS NOT NULL)+(SELECT count(*) FROM "CommunityTeam" WHERE "captainId" IS DISTINCT FROM "createdById" OR "captainLastActivityAt" IS NULL) AS count');
      teamBackfillInvalid = Number(r.count);
    }
    let newValues = 0;
    if (phase >= 120) {
      for (const table of ['TowerChallengeAttempt','PlayerClassified']) {
        const [r] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}" WHERE ${changedColumns[table].map(c => `"${c}" IS NOT NULL`).join(' OR ')}`);
        newValues += r.count;
      }
      for (const table of ['TowerChallengeAppeal','UserNotificationChannelPreference']) {
        const [r] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`);
        newValues += r.count;
      }
    }
    return { identity, history, schema: digest({columns: split.managed.columns, constraints: split.managed.constraints, indexes: split.managed.indexes, enums}), foreign, foreignLinks: foreignLinks.map(r => r.conname), data, runtimeDml, teamBackfillInvalid, newValues };
  }, { timeout: 30000 });
}
