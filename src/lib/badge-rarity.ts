import type { BadgeCategory, BadgeRarity } from "@prisma/client";

/**
 * Constantes de badges partagées entre `src/lib/badges.ts` (logique de
 * déblocage) et `src/lib/discord-badge-unlocked.ts` (notif Discord) —
 * extraites dans un fichier neutre plutôt que dans `badges.ts` lui-même
 * pour éviter un import circulaire (`badges.ts` importe déjà
 * `announceBadgeUnlocked` de `discord-badge-unlocked.ts`, qui aurait sinon
 * dû réimporter `badges.ts` pour ces libellés).
 */

/**
 * XP par défaut à l'unlock, dérivé de la rareté plutôt que fixé badge par
 * badge — la demande initiale ne précisait pas de montant explicite
 * (contrairement aux superlatifs/podium), donc une échelle simple et
 * documentée plutôt que des nombres arbitraires. Cohérent avec l'échelle
 * XP existante (PODIUM_1ST=50, PARTICIPATE=20…).
 */
export const BADGE_XP_BY_RARITY: Record<BadgeRarity, number> = {
  COMMON: 20,
  RARE: 40,
  EPIC: 75,
  LEGENDARY: 150,
};

export const RARITY_LABELS: Record<BadgeRarity, string> = {
  COMMON: "Commun",
  RARE: "Rare",
  EPIC: "Épique",
  LEGENDARY: "Légendaire",
};

export const CATEGORY_LABELS: Record<BadgeCategory, string> = {
  PARTICIPATION: "Participation",
  ENGAGEMENT: "Engagement",
  BIBLIOTHEQUE: "Bibliothèque",
  VOTE: "Vote & démocratie",
  SUPERLATIFS: "Superlatifs",
};

/**
 * Libellés FR des 7 types de critère (`BadgeCriteria["type"]`,
 * src/lib/badges.ts) — utilisés par le formulaire structuré de
 * `/admin/badges` (select type + nombre, plutôt qu'un textarea JSON
 * libre).
 */
export const CRITERIA_TYPE_LABELS: Record<string, string> = {
  SESSIONS_CREATED: "Soirées créées",
  SESSIONS_PARTICIPATED: "Soirées participées",
  VOTES_CAST: "Votes émis",
  SUPERLATIVES_WON: "Superlatifs gagnés",
  LIBRARY_SIZE: "Taille de la bibliothèque",
  STREAK_DAYS: "Streak (jours)",
  ACCOUNT_AGE_DAYS: "Ancienneté du compte (jours)",
};

export const CRITERIA_TYPES = Object.keys(CRITERIA_TYPE_LABELS);
