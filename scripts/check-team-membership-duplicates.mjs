// Précontrôle lecture seule avant la migration des équipes.
// Utilise exactement les mêmes garde-fous de cible que db-migrate.mjs.
// Aucune ligne n'est modifiée et aucune URL/secrète n'est affichée.
import { PrismaClient } from "@prisma/client";
import { assertSingleUrlSource, assertTarget, redact } from "./db-migrate-lib.mjs";

const secrets = [process.env.MIGRATION_DATABASE_URL];
const say = (message) => console.log(redact(message, secrets));

async function main() {
  assertSingleUrlSource(process.env);
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  const { target } = assertTarget({
    migrationUrl,
    runtimeUrl: process.env.DATABASE_URL,
    runtimeRole: process.env.GAMENIGHT_RUNTIME_ROLE,
    expectedTarget: process.env.GAMENIGHT_EXPECTED_TARGET,
    allowLocal: false,
    execute: false,
    skipRuntimeCheck: true,
  });
  secrets.push(target.password);
  say(`Cible vérifiée : ${target.host}:${target.port}/${target.database}`);

  const db = new PrismaClient({ datasourceUrl: migrationUrl });
  try {
    const duplicates = await db.$queryRawUnsafe(`
      SELECT "communityId", "userId", COUNT(*)::int AS occurrences
      FROM "CommunityTeamMember"
      GROUP BY "communityId", "userId"
      HAVING COUNT(*) > 1
      ORDER BY occurrences DESC
    `);
    if (duplicates.length) {
      console.error(`REFUSÉ : ${duplicates.length} paire(s) (communityId, userId) en doublon. Ne pas migrer.`);
      process.exitCode = 2;
      return;
    }
    console.log("OK : 0 doublon (communityId, userId) dans CommunityTeamMember.");

    const orphanCreators = await db.$queryRawUnsafe(`
      SELECT t."createdById"
      FROM "CommunityTeam" t
      LEFT JOIN "User" u ON u."id" = t."createdById"
      WHERE u."id" IS NULL
    `);
    if (orphanCreators.length) {
      console.error(`REFUSÉ : ${orphanCreators.length} créateur(s) d'équipe orphelin(s). La clé étrangère captainId échouerait; ne pas migrer.`);
      process.exitCode = 2;
      return;
    }
    console.log("OK : 0 créateur orphelin dans CommunityTeam.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(redact(`ERREUR : ${error?.message ?? error}`, secrets));
  process.exitCode = 1;
});
