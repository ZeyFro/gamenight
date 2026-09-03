/**
 * Barème XP validé (Axe 1 — XP participation). Centralisé ici pour que
 * chaque appelant (`createSession`, `toggleVote`, `closeSession`, les
 * actions dispos/Steam, et le script de backfill) parte de la même
 * source — jamais un nombre magique dupliqué à chaque appel.
 */
export const XP_AMOUNTS = {
  CREATE_SESSION: 30,
  VOTE: 5,
  PARTICIPATE: 20,
  AVAILABILITY_FIRST: 15,
  STEAM_LINK_FIRST: 15,
  // Axe 2 (PR 3/9) — bonus de résultats de soirée, en plus de PARTICIPATE
  // (déjà acquis à la clôture pour tout voteur du jeu gagnant). Un seul de
  // ces montants par user et par session (cf. `submitSessionResultsAction`
  // et `XpReason.SESSION_RESULT`).
  PODIUM_1ST: 50,
  PODIUM_2ND: 25,
  PODIUM_3RD: 10,
  COOP_BONUS: 15,
  // Sprint 3 suite (défis hebdo) — même montant fixe pour tous les
  // participants d'une soirée qui complète le défi de la semaine (cf.
  // spec, pas de variation par placement contrairement au podium).
  CHALLENGE_COMPLETE: 100,
  // Sprint 4 (Pronostics) — voir src/lib/pronostics.ts.
  PRONOSTIC_CORRECT: 50,
} as const;

/**
 * Formules pures du chantier XP/niveaux/rangs — aucune I/O ici
 * volontairement (ni Prisma, ni Discord), pour que `discord-level-up.ts`
 * puisse les utiliser sans créer de dépendance circulaire avec
 * `xp-actions.ts` (qui, lui, a besoin à la fois de ces formules et de
 * `announceLevelUp`).
 */

/**
 * Courbe de niveau — XP CUMULÉ requis pour ATTEINDRE un niveau donné,
 * niveau 1 = 0 XP (personne ne démarre "en dessous" du niveau 1). Formule
 * validée : `50 × (niveau-1)²`. Quelques repères concrets (utiles pour
 * juger si le barème XP est cohérent avec la courbe) :
 *   niveau 2 → 50 XP · niveau 5 → 800 XP · niveau 10 → 4 050 XP
 *   niveau 20 → 18 050 XP · niveau 50 → 120 050 XP · niveau 100 → 490 050 XP
 */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) ** 2;
}

/** Inverse de `xpForLevel` : le niveau le plus haut atteint avec `xp` XP. */
export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
}

/**
 * Titres FR par palier de niveau (humour "auto-dérision groupe de potes"
 * demandé) — paliers 1/5/10/20/50/100 fournis, paliers intermédiaires
 * ajoutés pour garder une progression qui "raconte quelque chose" entre
 * deux paliers fournis.
 */
const LEVEL_TITLES: { level: number; title: string }[] = [
  { level: 1, title: "Victime" },
  { level: 5, title: "Noob" },
  { level: 10, title: "PAPED" },
  { level: 15, title: "Habitué" },
  { level: 20, title: "Try-hard" },
  { level: 30, title: "Vétéran" },
  { level: 40, title: "Acharné" },
  { level: 50, title: "No-life" },
  { level: 70, title: "Possédé" },
  { level: 85, title: "Légende vivante" },
  { level: 100, title: "Sans-vie" },
];

export function titleForLevel(level: number): string {
  let current = LEVEL_TITLES[0].title;
  for (const tier of LEVEL_TITLES) {
    if (level < tier.level) break;
    current = tier.title;
  }
  return current;
}

export interface Rank {
  name: string;
  minLevel: number;
  colorClass: string;
  /** Couleur de l'anneau autour de l'avatar (PR 8/9, `RankAvatar`). */
  ringClass: string;
  /** Légende seule : halo pulsant continu sur l'anneau (`RankAvatar`). */
  glowing?: boolean;
}

/** Couleurs pensées pour un badge (texte + fond) — affinées visuellement en PR 8/9. */
export const RANKS: Rank[] = [
  {
    name: "Bronze",
    minLevel: 1,
    colorClass: "text-amber-700 bg-amber-700/10",
    ringClass: "ring-amber-700",
  },
  {
    name: "Argent",
    minLevel: 11,
    colorClass: "text-slate-300 bg-slate-300/10",
    ringClass: "ring-slate-300",
  },
  {
    name: "Or",
    minLevel: 26,
    colorClass: "text-yellow-400 bg-yellow-400/10",
    ringClass: "ring-yellow-400",
  },
  {
    name: "Platine",
    minLevel: 51,
    colorClass: "text-cyan-300 bg-cyan-300/10",
    ringClass: "ring-cyan-300",
  },
  {
    name: "Diamant",
    minLevel: 76,
    colorClass: "text-white bg-white/10",
    ringClass: "ring-white",
  },
  {
    name: "Légende",
    minLevel: 100,
    colorClass: "text-accent bg-accent/10",
    ringClass: "ring-accent",
    glowing: true,
  },
];

export function rankForLevel(level: number): Rank {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (level < rank.minLevel) break;
    current = rank;
  }
  return current;
}

// +5 %/jour de streak consécutif, plafonné à +50 % — atteint au jour 11
// (le jour 1 lui-même n'apporte pas encore de bonus, cf. `touchStreak`
// dans xp-actions.ts), pas exactement "jour 10" au sens strict mais c'est
// la conséquence directe de "le premier jour ne compte pas encore comme
// un streak".
const STREAK_BONUS_PER_DAY = 0.05;
const STREAK_BONUS_CAP = 0.5;

export function streakMultiplier(streakCount: number): number {
  if (streakCount <= 1) return 1;
  return 1 + Math.min((streakCount - 1) * STREAK_BONUS_PER_DAY, STREAK_BONUS_CAP);
}
