import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { MessageCategory } from "@prisma/client";

export type MessageVariables = Record<string, string>;

/** Un message Discord est limité à 2000 caractères : marge pour les variables substituées (pseudos, jeux). */
export const MAX_MESSAGE_TEXT_LENGTH = 1500;

export const ALL_MESSAGE_CATEGORIES: MessageCategory[] = [
  "SESSION_CREATED",
  "SESSION_MODIFIED",
  "REMINDER_24H",
  "REMINDER_2H",
  "LEVEL_UP",
  "SESSION_AWARDS",
  "BADGE_UNLOCKED",
];

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  SESSION_CREATED: "Création de soirée",
  SESSION_MODIFIED: "Modification de soirée",
  // PR 31 (2/4, Bloc A) : le timing des rappels devient configurable par
  // le créateur (`Session.reminderTimings`), donc ces deux catégories ne
  // correspondent plus littéralement à "24h avant"/"2h avant" — elles
  // restent les deux seuls tons de message disponibles ("loin"/hype vs
  // "proche"/urgent), choisi pour un timing donné via `isCloseReminder`
  // (seuil 3h, cf. src/lib/reminder-timings.ts). Libellés gardés
  // proches de l'original pour rester immédiatement compréhensibles sur
  // /admin?tab=messages, sans laisser croire à une correspondance exacte.
  REMINDER_24H: "Rappel (loin — ≥3h avant)",
  REMINDER_2H: "Rappel (proche — <3h avant)",
  LEVEL_UP: "Passage de niveau",
  SESSION_AWARDS: "Awards de récompenses",
  BADGE_UNLOCKED: "Badge débloqué",
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
  BADGE_UNLOCKED: ["user", "badge_name", "badge_icon", "rarity"],
};

export function variablesForCategories(categories: MessageCategory[]): string[] {
  return Array.from(new Set(categories.flatMap((c) => CATEGORY_VARIABLES[c])));
}

export interface InvalidCategoryVariable {
  category: MessageCategory;
  variable: string;
}

/**
 * Pour CHAQUE catégorie cochée individuellement (pas l'union de
 * `variablesForCategories`), vérifie que toutes les variables utilisées
 * dans `text` lui sont autorisées. Bug corrigé (remonté en prod) : un
 * message coché à la fois `REMINDER_24H` et `SESSION_CREATED` avec
 * `{jeu}` passait la validation "union" (puisque `{jeu}` existe bien pour
 * REMINDER_24H) alors que `SESSION_CREATED` seul ne le supporte pas —
 * envoyé tel quel à la création d'une session, `{jeu}` n'avait jamais de
 * valeur et laissait un trou dans le texte. Utilisé à la fois par le
 * formulaire (`MessageTemplateForm`, blocage à la saisie), les server
 * actions (`admin/messages/actions.ts`, filet de sécurité) et le script
 * `fix-invalid-templates.mjs` (désactivation des templates déjà en base).
 */
export function findInvalidCategoryVariables(
  text: string,
  categories: MessageCategory[]
): InvalidCategoryVariable[] {
  const usedVars = Array.from(
    new Set(Array.from(text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1]))
  );

  const invalid: InvalidCategoryVariable[] = [];
  for (const category of categories) {
    for (const variable of usedVars) {
      if (!CATEGORY_VARIABLES[category].includes(variable)) {
        invalid.push({ category, variable });
      }
    }
  }
  return invalid;
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
  BADGE_UNLOCKED: "🏆 {user} débloque {badge_icon} {badge_name} ({rarity})",
};

/**
 * Filet de sécurité pour `substituteVariables` : texte générique lisible
 * substitué à une variable qui apparaît dans un template mais n'a pas été
 * fournie pour cet envoi précis. Couvre toutes les variables connues de
 * `CATEGORY_VARIABLES`, toutes catégories confondues (une même clé comme
 * {createur} n'a besoin que d'une seule entrée ici).
 */
const GENERIC_VARIABLE_FALLBACKS: Record<string, string> = {
  heure: "l'heure",
  date: "la date",
  createur: "quelqu'un",
  ancienne_heure: "l'ancienne heure",
  ancienne_date: "l'ancienne date",
  pote: "un pote",
  jeu: "le jeu",
  user: "quelqu'un",
  ancien_niveau: "l'ancien niveau",
  nouveau_niveau: "le nouveau niveau",
  titre: "un titre",
  rang: "un rang",
  gagnants: "les gagnants",
  badge_name: "un badge",
  badge_icon: "🏆",
  rarity: "une rareté",
};

/**
 * Remplace les variables du modèle en un seul passage. Les valeurs (noms,
 * jeux…) sont littérales : ni `$&`, ni `{jeu}` contenu dans un pseudo ne
 * déclenchent de remplacement supplémentaire. Bug corrigé (texte "à trous", ex.
 * "c'est  à 20h" avec {jeu} substitué par du vide) : toute variable
 * restante après la substitution normale — typiquement `{jeu}` utilisée
 * par erreur dans un message coché `SESSION_CREATED`, qui n'a pas cette
 * variable — n'est plus retirée en silence. Elle est remplacée par un
 * texte générique lisible (`GENERIC_VARIABLE_FALLBACKS`) et loggée en
 * warning côté serveur, pour rester repérable même si un message invalide
 * passe malgré tout (le vrai filet de sécurité est maintenant en amont :
 * `/admin/messages` bloque la sauvegarde d'un tel message à la source,
 * voir `findInvalidCategoryVariables` — ceci reste une dernière défense,
 * pas la validation elle-même).
 */
export function substituteVariables(
  template: string,
  vars: MessageVariables
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    if (Object.hasOwn(vars, key)) return vars[key];
    logger.warn(
      "message-templates",
      `Variable {${key}} non fournie pour ce message — remplacée par un texte générique. Ce message est probablement coché pour une catégorie où {${key}} n'existe pas (voir /admin?tab=messages).`,
      { key, template }
    );
    return GENERIC_VARIABLE_FALLBACKS[key] ?? key.replaceAll("_", " ");
  });
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
