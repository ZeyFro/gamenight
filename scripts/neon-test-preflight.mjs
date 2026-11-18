// Lecture seule : aucun changement de rôle, de privilège ou de schéma.
import { pathToFileURL } from "node:url";

export const REQUIRED_DDL_TABLES = ["Membership", "CommunityTeam", "CommunityTeamMember", "TowerChallengeAttempt", "PlayerClassified"];
const refuse = code => { throw new Error(code); };

export function validateConnectionRoles(connection, runtimeRole, migrationRole) {
  if (!connection || !runtimeRole || !migrationRole) refuse("missing_role_configuration");
  if (runtimeRole === migrationRole) refuse("runtime_and_migration_roles_must_differ");
  let target;
  try { target = new URL(connection); } catch { refuse("invalid_migration_connection"); }
  if (decodeURIComponent(target.username) !== migrationRole) refuse("wrong_migration_login");
  if (!["require", "verify-full"].includes(target.searchParams.get("sslmode"))) refuse("tls_required");
  return { runtimeRole, migrationRole };
}

export function validateTestIdentity(i, roles) {
  if (i.project !== "misty-tooth-45335023" || i.branch !== "br-snowy-snow-b1cggq2w" || i.db !== "neondb" || i.role !== roles.migrationRole) refuse("wrong_test_identity");
}

export function validatePrivilegeReport(report, roles) {
  validateTestIdentity(report.identity, roles);
  const r = report.role;
  if (!r.rolcanlogin || r.rolinherit || ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"].some(k => r[k]) || report.memberships !== 0) refuse("migration_role_too_privileged");
  if (report.owners.length !== REQUIRED_DDL_TABLES.length || REQUIRED_DDL_TABLES.some(name => !report.owners.some(t => t.relname === name && t.owned))) refuse("missing_required_ddl_ownership");
  if (!report.enumOwned) refuse("missing_enum_ownership");
  const required = ["schema_create", "schema_usage", "user_id_select", "user_id_references", "community_id_references", "history_select", "history_insert", "history_update_logs", "history_update_finished", "history_update_steps", "runtime_new_table_dml"];
  if (required.some(k => report.privileges[k] !== true)) refuse("missing_required_privilege");
}

async function main() {
  const env = process.env;
  const roles = validateConnectionRoles(env.MIGRATION_DATABASE_URL, env.GAMENIGHT_RUNTIME_ROLE, env.GAMENIGHT_MIGRATION_ROLE);
  // Ces fichiers sont copiés depuis le SHA revu de #370 avant cette étape.
  const { assertTarget, assertSingleUrlSource } = await import(new URL("db-migrate-lib.mjs", import.meta.url).href);
  assertSingleUrlSource(env);
  assertTarget({ migrationUrl: env.MIGRATION_DATABASE_URL, runtimeRole: roles.runtimeRole, expectedTarget: env.GAMENIGHT_EXPECTED_TARGET, execute: false });
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: env.MIGRATION_DATABASE_URL });
  try {
    const report = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS db,current_user AS role,current_setting('neon.project_id',true) AS project,current_setting('neon.branch_id',true) AS branch");
      validateTestIdentity(identity, roles);
      const [role] = await tx.$queryRawUnsafe("SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user");
      const [membership] = await tx.$queryRawUnsafe("SELECT count(*)::int AS count FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)");
      const owners = await tx.$queryRawUnsafe(`SELECT c.relname,c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Membership','CommunityTeam','CommunityTeamMember','TowerChallengeAttempt','PlayerClassified')`);
      const [enumRow] = await tx.$queryRawUnsafe("SELECT typowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_type WHERE typname='UserNotificationCategory' AND typnamespace='public'::regnamespace");
      const [privileges] = await tx.$queryRawUnsafe(`SELECT
        has_schema_privilege(current_user,'public','CREATE') AS schema_create,
        has_schema_privilege(current_user,'public','USAGE') AS schema_usage,
        has_column_privilege(current_user,'public."User"','id','SELECT') AS user_id_select,
        has_column_privilege(current_user,'public."User"','id','REFERENCES') AS user_id_references,
        has_column_privilege(current_user,'public."Community"','id','REFERENCES') AS community_id_references,
        has_table_privilege(current_user,'public._prisma_migrations','SELECT') AS history_select,
        has_table_privilege(current_user,'public._prisma_migrations','INSERT') AS history_insert,
        has_column_privilege(current_user,'public._prisma_migrations','logs','UPDATE') AS history_update_logs,
        has_column_privilege(current_user,'public._prisma_migrations','finished_at','UPDATE') AS history_update_finished,
        has_column_privilege(current_user,'public._prisma_migrations','applied_steps_count','UPDATE') AS history_update_steps`);
      const [defaults] = await tx.$queryRawUnsafe(`SELECT count(DISTINCT a.privilege_type)=4 AS runtime_new_table_dml FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='r' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1) AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')`,roles.runtimeRole);
      const [preconditions] = await tx.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM (SELECT "communityId", "userId" FROM "CommunityTeamMember" GROUP BY "communityId", "userId" HAVING count(*) > 1) d) AS duplicates, (SELECT count(*)::int FROM "CommunityTeam" t LEFT JOIN "User" u ON u.id=t."createdById" WHERE t."createdById" IS NOT NULL AND u.id IS NULL) AS orphans');
      if (preconditions.duplicates !== 0 || preconditions.orphans !== 0) refuse("invalid_data_preconditions");
      return { identity, role, memberships: membership.count, owners, enumOwned: enumRow?.owned === true, privileges: {...privileges,...defaults} };
    });
    validatePrivilegeReport(report, roles);
    console.log("Préflight lecture seule : cible test, rôles distincts, privilèges et propriétés DDL vérifiés.");
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Ne jamais reproduire les erreurs du pilote qui peuvent contenir l'URL.
    const known = /^(missing_|wrong_|invalid_|tls_required|runtime_and_|migration_role_)/;
    console.error(known.test(error?.message ?? "") ? error.message : "native_test_preflight_failed");
    process.exitCode = 2;
  });
}
