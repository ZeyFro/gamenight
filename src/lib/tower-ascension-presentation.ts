import {
  levelForXp,
  xpForLevel,
  titleForLevel,
  rankForLevel,
  Rank,
} from "./xp";

/**
 * Présentation de l'Ascension d'un joueur (individuelle, par communauté).
 *
 * Réutilise le modèle XP/niveaux/rangs validé du cahier (xp.ts) — courbe
 * `50 × (niveau-1)²`, titres FR par palier, rangs Bronze → Légende. Aucun
 * comportement nouveau : cette fonction ne change aucune règle d'attribution
 * d'XP, elle expose seulement l'état de progression à des fins de lecture.
 *
 * - XP individuel : `CommunityMemberStats.xpTotal` (par membre, par
 *   communauté) — progression permanente.
 * - XP équipe : traçable séparément via `community-team-score` (équipe) —
 *   les deux ne sont jamais additionnés ni confondus.
 */
export type AscensionView = {
  xpTotal: number;
  level: number;
  title: string;
  rank: Rank;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  xpToNextLevel: number;
  xpProgress: number;
  percentToNextLevel: number;
  season?: string;
};

export function describeAscension(xpTotal: number, season?: string): AscensionView {
  const level = levelForXp(xpTotal);
  const xpForCurrentLevel = xpForLevel(level);
  const xpForNextLevel = xpForLevel(level + 1);
  const xpToNextLevel = xpForNextLevel - xpForCurrentLevel;
  const xpProgress = xpTotal - xpForCurrentLevel;
  const percentToNextLevel = xpToNextLevel > 0 ? xpProgress / xpToNextLevel : 1;
  return {
    xpTotal,
    level,
    title: titleForLevel(level),
    rank: rankForLevel(level),
    xpForCurrentLevel,
    xpForNextLevel,
    xpToNextLevel,
    xpProgress,
    percentToNextLevel,
    season,
  };
}

/**
 * Séparation stricte XP individuel / équipe — valeurs nommées pour qu'un
 * appelant Discord/frontend ne mélange jamais les deux.
 */
export const XP_SCOPE = {
  INDIVIDUAL: "individual" as const,
  TEAM: "team" as const,
} as const;
export type XpScope = (typeof XP_SCOPE)[keyof typeof XP_SCOPE];

export function xpScopeLabel(scope: XpScope): string {
  return scope === XP_SCOPE.INDIVIDUAL ? "XP individuel (membre)" : "XP d'équipe";
}
