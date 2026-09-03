// Bootstrap de la Saison 1 (Sprint 4, FEATURE 3 "Saisons mensuelles").
// Node/ESM autonome, même philosophie que les autres scripts prisma/*.mjs.
//
// Idempotent PAR EXISTENCE : ne crée Saison 1 que si aucune ligne `Season`
// n'existe encore — les saisons suivantes sont créées par
// `finalizeSeasonIfDue` (src/lib/seasons.ts), jamais par ce script (qui ne
// tourne qu'une fois, au premier déploiement de cette PR).
//
// PAS de reset rétroactif au bootstrap (cf. spec) : les scores XP actuels
// des users restent tels quels, la Saison 1 démarre avec eux comme "tête
// de départ" — seule la fin de Saison 1 (dans un mois) déclenchera le
// premier vrai reset.
//
// `new Date()` (UTC serveur) plutôt que `wallClockNow()` (src/lib/
// wallclock.ts, alias `@/...` non exécutable tel quel par Node, même
// raison que les autres seeds qui dupliquent leur logique) : une
// précision à la journée près suffit pour une date de bootstrap qui ne se
// rejoue qu'une fois.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function endOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

async function main() {
  const existing = await prisma.season.findFirst();
  if (existing) {
    console.log("[seed-season] Une saison existe déjà — rien à faire.");
    return;
  }

  const now = new Date();
  const season = await prisma.season.create({
    data: {
      number: 1,
      name: "Saison 1",
      startDate: now,
      endDate: endOfMonthUtc(now),
      isActive: true,
    },
  });
  console.log(
    `[seed-season] Saison 1 créée (id ${season.id}), fin le ${season.endDate.toISOString()}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
