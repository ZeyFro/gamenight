// Seed des messages Discord par défaut (rappels F7 + notifs de
// création/modification de session). Script Node/ESM autonome (pas de
// ts-node/tsx en dépendance) — lancer avec :
//   node prisma/seed.mjs
// Idempotent PAR CATÉGORIE : chaque groupe de messages n'est inséré que
// si aucun MessageTemplate existant ne porte déjà une de ses catégories —
// pas un seul check global, pour rester correct en 2 cas : relancer le
// script ne duplique rien, ET une base migrée depuis l'ancien
// ReminderTemplate (9 messages déjà tagués REMINDER_24H/2H par la
// migration) reçoit quand même les nouveaux messages SESSION_CREATED/
// SESSION_MODIFIED au lieu d'être bloquée par un check "déjà seedé".

import { PrismaClient } from "@prisma/client";

const REMINDER_MESSAGES = [
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

const SESSION_CREATED_MESSAGES = [
  "📣 OUVREZ LES YEUX. {createur} vient de créer une soirée pour {date} à {heure}. VOTEZ MAINTENANT, pas dans 3 jours.",
  "🚨 SOIRÉE INCOMING : {date} à {heure}. {createur} a posé le truc, à vous de jouer — littéralement.",
  "Yo tout le monde, {createur} vient de sortir une soirée le {date} à {heure}. Qui vote pas, qui joue pas, qui se plaint pas après.",
  "NOUVELLE SOIRÉE DÉTECTÉE 🎮 {date} à {heure}, merci {createur}. Direction l'app, TOUT DE SUITE.",
];

const SESSION_MODIFIED_MESSAGES = [
  "⚠️ Soirée décalée par {createur} : nouveau rendez-vous {date} à {heure} (c'était {ancienne_date} à {ancienne_heure}).",
  "⚠️ Changement de programme : {createur} a bougé la soirée à {date}, {heure}. Notez bien le nouveau créneau.",
  "⚠️ Ancien créneau ({ancienne_date} à {ancienne_heure}) annulé, nouveau créneau : {date} à {heure}. Merci {createur}.",
];

const prisma = new PrismaClient();

async function seedCategoryGroup(categories, messages, variables) {
  const existing = await prisma.messageTemplate.count({
    where: { categories: { hasSome: categories } },
  });
  if (existing > 0) {
    console.log(
      `${categories.join("+")} : ${existing} message(s) déjà en base — rien à faire.`
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

  await prisma.messageTemplate.createMany({
    data: messages.map((text) => ({
      text,
      categories,
      variables,
      createdById: author.id,
    })),
  });

  console.log(`${messages.length} message(s) créés pour ${categories.join("+")}.`);
}

async function main() {
  await seedCategoryGroup(
    ["REMINDER_24H", "REMINDER_2H"],
    REMINDER_MESSAGES,
    ["pote", "jeu", "heure"]
  );
  await seedCategoryGroup(
    ["SESSION_CREATED"],
    SESSION_CREATED_MESSAGES,
    ["heure", "date", "createur"]
  );
  await seedCategoryGroup(
    ["SESSION_MODIFIED"],
    SESSION_MODIFIED_MESSAGES,
    ["heure", "date", "createur", "ancienne_heure", "ancienne_date"]
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
