// Empreinte LECTURE SEULE de la base (compteurs et dates) pour prouver une restauration Neon.
// Exécute scripts/restore-fingerprint.sql, la même requête que celle à coller dans la console Neon
// sur la branche restaurée. Transaction READ ONLY ; n'affiche jamais l'URL, l'hôte ni de donnée
// personnelle. Code de sortie : 0 = empreinte écrite, 1 = erreur.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { assertDirectUrl } from "./precheck-team-membership.mjs";

export const FINGERPRINT_SQL = new URL("./restore-fingerprint.sql", import.meta.url);

export function formatFingerprint(rows) {
  return rows.map((row) => `${row.mesure} : ${row.valeur}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  try {
    assertDirectUrl(url);
  } catch (error) {
    console.error(`REFUSÉ : ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const sql = readFileSync(FINGERPRINT_SQL, "utf8");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return tx.$queryRawUnsafe(sql);
    });
    console.log(`Empreinte prise le ${new Date().toISOString()} (UTC)`);
    for (const line of formatFingerprint(rows)) console.log(line);
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Le message Prisma peut citer l'hôte : seulement la classe d'erreur et le code.
    console.error(`ERREUR technique (${error?.code ?? error?.name ?? "inconnue"}).`);
    process.exitCode = 1;
  });
}
