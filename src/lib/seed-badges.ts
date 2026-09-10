import { prisma } from "@/lib/prisma";
import { BADGE_XP_BY_RARITY } from "@/lib/badge-rarity";
import type { BadgeCriteria } from "@/lib/badges";
import type { BadgeCategory, BadgeRarity } from "@prisma/client";

/**
 * Seed des 15 badges automatiques par défaut. Convertie depuis
 * `prisma/seed-badges.mjs` (PR "build ne fait plus que compiler") :
 * importe directement `BADGE_XP_BY_RARITY` de `@/lib/badge-rarity` au
 * lieu de le dupliquer — l'ancienne version Node/ESM autonome ne pouvait
 * pas résoudre l'alias `@/...`.
 *
 * Idempotent PAR NOM (`Badge.name` est `@unique`) : un badge déjà en base
 * avec ce nom exact n'est jamais recréé ni écrasé — si son critère ou son
 * XP est modifié depuis `/admin/badges` ou directement en base, ce script
 * ne revient jamais dessus.
 */

interface BadgeSeed {
  name: string;
  icon: string;
  description: string;
  category: BadgeCategory;
  rarity: BadgeRarity;
  criteria: BadgeCriteria;
}

const BADGES: BadgeSeed[] = [
  {
    name: "First Blood",
    icon: "🎉",
    description: "Créer sa première soirée.",
    category: "PARTICIPATION",
    rarity: "COMMON",
    criteria: { type: "SESSIONS_CREATED", count: 1 },
  },
  {
    name: "Habitué",
    icon: "🎮",
    description: "Participer à 10 soirées.",
    category: "PARTICIPATION",
    rarity: "COMMON",
    criteria: { type: "SESSIONS_PARTICIPATED", count: 10 },
  },
  {
    name: "GOAT",
    icon: "🏆",
    description: "Participer à 50 soirées.",
    category: "PARTICIPATION",
    rarity: "RARE",
    criteria: { type: "SESSIONS_PARTICIPATED", count: 50 },
  },
  {
    name: "LÉGENDE",
    icon: "👑",
    description: "Participer à 100 soirées.",
    category: "PARTICIPATION",
    rarity: "LEGENDARY",
    criteria: { type: "SESSIONS_PARTICIPATED", count: 100 },
  },
  {
    name: "Marathon",
    icon: "⚡",
    description: "7 jours de connexion d'affilée.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "STREAK_DAYS", count: 7 },
  },
  {
    name: "Insomniaque",
    icon: "🔥",
    description: "30 jours de connexion d'affilée.",
    category: "ENGAGEMENT",
    rarity: "EPIC",
    criteria: { type: "STREAK_DAYS", count: 30 },
  },
  {
    name: "Ancien",
    icon: "💎",
    // 182 jours ≈ 6 mois.
    description: "6 mois sur l'app.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "ACCOUNT_AGE_DAYS", count: 182 },
  },
  {
    name: "Vétéran",
    icon: "🌟",
    description: "1 an sur l'app.",
    category: "ENGAGEMENT",
    rarity: "EPIC",
    criteria: { type: "ACCOUNT_AGE_DAYS", count: 365 },
  },
  {
    name: "Bibliophile",
    icon: "📚",
    description: "30 jeux ou plus dans sa bibliothèque.",
    category: "BIBLIOTHEQUE",
    rarity: "COMMON",
    criteria: { type: "LIBRARY_SIZE", count: 30 },
  },
  {
    name: "Collectionneur",
    icon: "🎯",
    description: "100 jeux ou plus dans sa bibliothèque.",
    category: "BIBLIOTHEQUE",
    rarity: "RARE",
    criteria: { type: "LIBRARY_SIZE", count: 100 },
  },
  {
    name: "Citoyen",
    icon: "🗳️",
    description: "20 votes émis.",
    category: "VOTE",
    rarity: "COMMON",
    criteria: { type: "VOTES_CAST", count: 20 },
  },
  {
    name: "Meneur",
    icon: "📣",
    description: "Créer 5 soirées.",
    category: "VOTE",
    rarity: "COMMON",
    criteria: { type: "SESSIONS_CREATED", count: 5 },
  },
  {
    name: "Community leader",
    icon: "🎤",
    description: "Créer 20 soirées.",
    category: "VOTE",
    rarity: "RARE",
    criteria: { type: "SESSIONS_CREATED", count: 20 },
  },
  {
    name: "Compétiteur",
    icon: "🥇",
    description: "Gagner 5 superlatifs.",
    category: "SUPERLATIFS",
    rarity: "RARE",
    criteria: { type: "SUPERLATIVES_WON", count: 5 },
  },
  {
    name: "Star",
    icon: "🌟",
    description: "Gagner 20 superlatifs.",
    category: "SUPERLATIFS",
    rarity: "EPIC",
    criteria: { type: "SUPERLATIVES_WON", count: 20 },
  },
  {
    name: "Challenger",
    icon: "🎯",
    description: "Compléter 5 défis hebdo.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "CHALLENGES_COMPLETED", count: 5 },
  },
  {
    name: "Oracle",
    icon: "🔮",
    description: "10 pronostics corrects.",
    category: "ENGAGEMENT",
    rarity: "EPIC",
    criteria: { type: "PRONOSTICS_CORRECT", count: 10 },
  },
  {
    name: "High Roller",
    icon: "🎲",
    description: "Gagner 5 paris d'XP.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "BETS_WON", count: 5 },
  },
  {
    name: "All In",
    icon: "💰",
    description: "Parier 50% de son XP sur un pari... et le gagner.",
    category: "ENGAGEMENT",
    rarity: "LEGENDARY",
    criteria: { type: "ALL_IN_WIN", count: 1 },
  },
  {
    name: "Champion de tournoi",
    icon: "🏆",
    description: "Gagner un tournoi.",
    category: "ENGAGEMENT",
    rarity: "EPIC",
    criteria: { type: "TOURNAMENTS_WON", count: 1 },
  },
  {
    name: "Gladiateur",
    icon: "⚔️",
    description: "Participer à 5 tournois.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "TOURNAMENTS_PARTICIPATED", count: 5 },
  },
];

export async function seedBadges(): Promise<void> {
  const author = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!author) return; // aucun user pour l'instant — reporté au prochain passage

  for (const badge of BADGES) {
    const existing = await prisma.badge.findUnique({ where: { name: badge.name } });
    if (existing) continue;

    const xpReward = BADGE_XP_BY_RARITY[badge.rarity];
    await prisma.badge.create({ data: { ...badge, xpReward, modifiedById: author.id } });
  }
}
