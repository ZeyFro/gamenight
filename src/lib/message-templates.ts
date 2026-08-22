import { prisma } from "@/lib/prisma";
import type { MessageCategory } from "@prisma/client";

export type MessageVariables = Record<string, string>;

export const ALL_MESSAGE_CATEGORIES: MessageCategory[] = [
  "SESSION_CREATED",
  "SESSION_MODIFIED",
  "REMINDER_24H",
  "REMINDER_2H",
  "LEVEL_UP",
  "SESSION_AWARDS",
];

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  SESSION_CREATED: "Création de soirée",
  SESSION_MODIFIED: "Modification de soirée",
  REMINDER_24H: "Rappel 24h avant",
  REMINDER_2H: "Rappel 2h avant",
  LEVEL_UP: "Passage de niveau",
  SESSION_AWARDS: "Awards de superlatifs",
};

/**
 * Variables réellement substituées pour chaque catégorie (cf.
 * `sendSessionCreatedNotification`/`sendSessionModifiedNotification`/
 * `sendSessionReminder`) — source de vérité unique, utilisée à la fois
 * pour l'aide contextuelle de `/admin/messages` et pour calculer
 * `MessageTemplate.variables` (champ informationnel, jamais saisi
 * librement : toujours dérivé des catégories cochées pour ne jamais
 * partir en désync).
 */
export const CATEGORY_VARIABLES: Record<MessageCategory, string[]> = {
  SESSION_CREATED: ["heure", "date", "createur"],
  SESSION_MODIFIED: [
    "heure",
    "date",
    "createur",
    "ancienne_heure",
    "ancienne_date",
  ],
  REMINDER_24H: ["pote", "jeu", "heure"],
  REMINDER_2H: ["pote", "jeu", "heure"],
  LEVEL_UP: ["user", "ancien_niveau", "nouveau_niveau", "titre", "rang"],
  SESSION_AWARDS: ["gagnants"],
};

export function variablesForCategories(categories: MessageCategory[]): string[] {
  return Array.from(new Set(categories.flatMap((c) => CATEGORY_VARIABLES[c])));
}

/**
 * Repli hardcodé utilisé quand aucun `MessageTemplate` actif n'existe pour
 * une catégorie donnée — ne devrait arriver qu'avant le premier seed, ou
 * si tous les messages d'une catégorie ont été désactivés/supprimés
 * depuis `/admin/messages`. Jamais de message vide ou d'échec silencieux.
 */
const FALLBACKS: Record<MessageCategory, string> = {
  SESSION_CREATED: "📣 Nouvelle soirée créée pour {date} à {heure}",
  SESSION_MODIFIED: "⚠️ Soirée décalée : nouveau créneau {date} à {heure}",
  REMINDER_24H: "🎮 Rappel : {jeu} à {heure} ! {pote}",
  REMINDER_2H: "🎮 Rappel : {jeu} à {heure} ! {pote}",
  LEVEL_UP: "🎉 {user} passe niveau {nouveau_niveau} — désormais {titre} !",
  SESSION_AWARDS: "🏆 Les awards de la soirée :\n{gagnants}",
};

/**
 * Remplace chaque `{clé}` de `vars` dans `template` (substitution simple,
 * pas d'échappement). Toute variable restante après ça — typiquement
 * `{jeu}` utilisée par erreur dans un message `SESSION_MODIFIED`, qui n'a
 * pas cette variable — est retirée silencieusement plutôt que laissée
 * littéralement dans le message envoyé (bug corrigé : `/admin/messages` ne
 * bloque pas la sauvegarde d'un message avec une variable hors catégorie,
 * cf. validation côté admin ; ce filet de sécurité runtime garantit qu'un
 * tel message reste quand même présentable une fois posté dans Discord).
 */
export function substituteVariables(
  template: string,
  vars: MessageVariables
): string {
  const substituted = Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template
  );
  return substituted.replace(/\{[a-zA-Z0-9_]+\}/g, "");
}

/**
 * Tire un message actif au hasard parmi les `MessageTemplate` dont
 * `categories` contient `category`, puis substitue les variables. Point
 * d'entrée unique pour toutes les catégories de `ALL_MESSAGE_CATEGORIES`
 * — le résultat de vote (F6) n'y passe pas, c'est un embed structuré
 * indépendant.
 */
export async function pickMessageTemplate(
  category: MessageCategory,
  vars: MessageVariables
): Promise<string> {
  const templates = await prisma.messageTemplate.findMany({
    where: { active: true, categories: { has: category } },
  });

  const text =
    templates.length > 0
      ? templates[Math.floor(Math.random() * templates.length)].text
      : FALLBACKS[category];

  return substituteVariables(text, vars);
}
