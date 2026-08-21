// Seed des 9 messages de rappel initiaux (F7). Script Node/ESM autonome
// (pas de ts-node/tsx en dépendance) — lancer avec :
//   node prisma/seed.mjs
// Idempotent : ne fait rien si des ReminderTemplate existent déjà, pour
// ne pas dupliquer la liste si le script est relancé par erreur.

import { PrismaClient } from "@prisma/client";

const MESSAGES = [
  "Yo {pote}, dans 30 min c'est {jeu}. Prépare ta Vodka KURVA",
  "Alerte : {jeu} à {heure}. Absent = tu paies ta biere ORGEN 🍕",
  "Ton clavier chauffe déjà pour {jeu} ? T'as intérêt de me chauffer aussi.",
  "Ne soit pas en retard comme charles ce soir c'est {jeu}. Prépare toi Tsuka BLYAT.",
  "Ho non... j'ai fait tomber le {jeu} tu dois venir à {heure} dépêche toi.",
  "Pas de retard sinon on te RAID mon gars",
  "POLICE DE LETHAL PERSONNE BOUGE CE SOIR C'EST {jeu}",
  "OK GARMIN LANCE {jeu}",
  "ORGEN ORGEN ORGEN {jeu} {heure}",
];

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.reminderTemplate.count();
  if (existing > 0) {
    console.log(
      `${existing} message(s) de rappel déjà en base — rien à faire.`
    );
    return;
  }

  const author = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!author) {
    console.error(
      "Aucun utilisateur en base. Connecte-toi au moins une fois via Discord avant de lancer ce seed."
    );
    process.exitCode = 1;
    return;
  }

  await prisma.reminderTemplate.createMany({
    data: MESSAGES.map((text) => ({ text, createdById: author.id })),
  });

  console.log(
    `${MESSAGES.length} messages de rappel créés (attribués à ${author.discordName}).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
