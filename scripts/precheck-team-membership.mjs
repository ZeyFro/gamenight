// Précontrôle LECTURE SEULE avant la migration des équipes (#370).
// Ne modifie aucune ligne : transaction PostgreSQL READ ONLY, requêtes de comptage uniquement.
// N'affiche jamais l'URL, l'hôte ni d'identifiant : seulement des compteurs.
// Code de sortie : 0 = migration possible, 2 = refus (ne pas migrer), 1 = erreur technique.
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export function assertDirectUrl(url) {
  if (!url) throw new Error("DATABASE_URL absent.");
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error("DATABASE_URL n'est pas une URL PostgreSQL.");
  if (url.includes("-pooler")) throw new Error("L'URL contient -pooler : utiliser l'URL directe.");
}

export function evaluate({ unfinished, duplicates, orphans, lastMigration }) {
  const lines = [`Dernière migration terminée : ${lastMigration ?? "aucune"}`];
  const refusals = [];
  if (unfinished > 0) refusals.push(`${unfinished} migration(s) inachevée(s) dans _prisma_migrations`);
  if (duplicates > 0) refusals.push(`${duplicates} paire(s) (communityId, userId) en doublon dans CommunityTeamMember`);
  if (orphans > 0) refusals.push(`${orphans} équipe(s) dont le créateur n'existe plus (la clé étrangère captainId échouerait)`);
  lines.push(`Migrations inachevées : ${unfinished}`);
  lines.push(`Doublons (communityId, userId) : ${duplicates}`);
  lines.push(`Créateurs d'équipe orphelins : ${orphans}`);
  if (refusals.length) {
    return { exitCode: 2, lines: [...lines, ...refusals.map((r) => `REFUSÉ : ${r}. Ne pas migrer.`)] };
  }
  return { exitCode: 0, lines: [...lines, "OK : aucun obstacle à la migration des équipes."] };
}

async function main() {
  const url = process.env.DATABASE_URL;
  try {
    assertDirectUrl(url);
  } catch (error) {
    // Message de configuration sans secret : affiché tel quel.
    console.error(`REFUSÉ : ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [{ n: unfinished }] = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
      );
      const last = await tx.$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
      );
      const [{ n: duplicates }] = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT 1 FROM "CommunityTeamMember" GROUP BY "communityId", "userId" HAVING COUNT(*) > 1
         ) d`,
      );
      const [{ n: orphans }] = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "CommunityTeam" t LEFT JOIN "User" u ON u."id" = t."createdById" WHERE u."id" IS NULL`,
      );
      return { unfinished, duplicates, orphans, lastMigration: last[0]?.migration_name };
    });
    const { exitCode, lines } = evaluate(result);
    for (const line of lines) console.log(line);
    process.exitCode = exitCode;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Le message Prisma peut citer l'hôte : on n'affiche que la classe d'erreur et le code.
    console.error(`ERREUR technique (${error?.code ?? error?.name ?? "inconnue"}). Voir le journal Prisma côté serveur.`);
    process.exitCode = 1;
  });
}
