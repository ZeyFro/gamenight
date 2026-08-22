// Seed des messages Discord par défaut (rappels F7 + notifs de
// création/modification de session). Node/ESM autonome (pas de
// ts-node/tsx en dépendance).
//
// Bug corrigé : ce script n'était appelé QUE manuellement (`npm run
// seed`) — jamais par le build Vercel. Résultat en prod : les 9 rappels
// F7 existaient (migrés depuis l'ancien ReminderTemplate), mais les
// nouveaux messages SESSION_CREATED/SESSION_MODIFIED n'ont jamais été
// créés, personne n'ayant lancé le seed à la main après la migration —
// d'où le fallback hardcodé systématique à la création d'une session.
// Le script tourne maintenant à CHAQUE build (`npm run build` :
// `prisma migrate deploy && node prisma/seed.mjs && next build`), donc
// il doit rester silencieux et sûr à rejouer indéfiniment :
// - Idempotent PAR CATÉGORIE : chaque groupe n'est inséré que si aucun
//   MessageTemplate existant ne porte déjà une de ses catégories — pas
//   un seul check global, sinon une base déjà migrée avec les 9 rappels
//   ne recevrait jamais les nouveaux groupes.
// - Base toute neuve (déploiement initial, personne ne s'est encore
//   connecté) : pas d'utilisateur pour porter `createdById` → le script
//   log un avertissement et NE FAIT RIEN pour ce groupe, sans faire
//   échouer le build (`process.exitCode` reste à 0). Il se rattrapera
//   tout seul au prochain déploiement, une fois qu'un compte existera.

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

const LEVEL_UP_MESSAGES = [
  "🎉 {user} monte au niveau {nouveau_niveau} — désormais {titre}.",
  "⚡ {user} vient de passer {rang} ! Niveau {nouveau_niveau}, {titre}.",
  "📈 {user} : niveau {ancien_niveau} → {nouveau_niveau}. {titre} approuve.",
  "🏅 Ding ! {user} est maintenant niveau {nouveau_niveau} ({titre}).",
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
    // Pas une erreur de build : arrive normalement au tout premier
    // déploiement, avant que quiconque se soit connecté. Le prochain
    // build (déclenché par le prochain déploiement, ou en relançant
    // manuellement `npm run seed`) réessaiera automatiquement.
    console.warn(
      `${categories.join("+")} : aucun utilisateur en base pour l'instant — seed reporté au prochain build.`
    );
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
  await seedCategoryGroup(
    ["LEVEL_UP"],
    LEVEL_UP_MESSAGES,
    ["user", "ancien_niveau", "nouveau_niveau", "titre", "rang"]
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
