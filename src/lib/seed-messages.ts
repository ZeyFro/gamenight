import { prisma } from "@/lib/prisma";
import type { MessageCategory } from "@prisma/client";

/**
 * Seed des messages Discord par défaut (rappels F7 + notifs de
 * création/modification de session). Convertie depuis `prisma/seed.mjs`
 * (PR "build ne fait plus que compiler") — cette version importe
 * directement `@/lib/prisma`, plus besoin de dupliquer quoi que ce soit
 * (l'ancienne version Node/ESM autonome ne pouvait pas résoudre l'alias
 * `@/...`).
 *
 * Idempotent PAR CATÉGORIE : chaque groupe n'est inséré que si aucun
 * `MessageTemplate` existant ne porte déjà une de ses catégories — pas un
 * seul check global, sinon une base déjà migrée avec les 9 rappels ne
 * recevrait jamais les nouveaux groupes.
 *
 * Base toute neuve (déploiement initial, personne ne s'est encore
 * connecté) : pas d'utilisateur pour porter `createdById` → log un
 * avertissement et NE FAIT RIEN pour ce groupe, sans lever d'exception —
 * se rattrape tout seul au prochain passage.
 */

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

const SESSION_AWARDS_MESSAGES = [
  "🏆 Les awards tombent :\n{gagnants}",
  "⚡ Voici les vainqueurs :\n{gagnants}\nApplaudissez.",
  "Palmarès de la soirée :\n{gagnants}\nBravo les gars.",
];

const BADGE_UNLOCKED_MESSAGES = [
  "🏆 {user} vient de débloquer {badge_icon} {badge_name} — {rarity} !",
  "🎉 Nouveau badge pour {user} : {badge_icon} {badge_name}",
  "⚡ {user} unlock {badge_icon} {badge_name}, {rarity} édition !",
];

async function seedCategoryGroup(
  categories: MessageCategory[],
  messages: string[],
  variables: string[]
): Promise<void> {
  const existing = await prisma.messageTemplate.count({
    where: { categories: { hasSome: categories } },
  });
  if (existing > 0) return;

  const author = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!author) return; // aucun user pour l'instant — reporté au prochain passage

  await prisma.messageTemplate.createMany({
    data: messages.map((text) => ({
      text,
      categories,
      variables,
      createdById: author.id,
      modifiedById: author.id,
    })),
  });
}

export async function seedDefaultMessages(): Promise<void> {
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
  await seedCategoryGroup(["SESSION_AWARDS"], SESSION_AWARDS_MESSAGES, ["gagnants"]);
  await seedCategoryGroup(
    ["BADGE_UNLOCKED"],
    BADGE_UNLOCKED_MESSAGES,
    ["user", "badge_name", "badge_icon", "rarity"]
  );
}
