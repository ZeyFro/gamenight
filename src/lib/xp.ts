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
  // Sprint 5 (Tournois Bracket) — voir src/lib/tournaments.ts.
  TOURNAMENT_1ST: 200,
  TOURNAMENT_2ND: 100,
  TOURNAMENT_SEMIFINALIST: 50,
} as const;

/**
 * Plafond anti-farm des gains « soirée créée » : au plus
 * `CREATE_SESSION_DAILY_XP_CAP` gains `CREATE_SESSION` par membre, par
 * communauté, sur une fenêtre glissante de 24 h (pas un jour calendaire, qui
 * autoriserait deux séries rapprochées autour de minuit). Compté dans le
 * ledger `XpEvent` lui-même : une soirée supprimée juste après sa création
 * garde son gain dans le ledger, donc continue de compter.
 */
export const CREATE_SESSION_DAILY_XP_CAP = 3;
export const CREATE_SESSION_XP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Plafond anti-farm des gains « présence » (audit du 23/11/2026, constat 1.9) : `PARTICIPATE` est versé à chaque votant de la
 * proposition gagnante à la clôture, sans preuve de présence, et le créateur clôt lui-même. Des comptes complices pouvaient donc
 * toucher 20 XP par soirée fantôme, sans limite. Même règle que « soirée créée » : au plus `PARTICIPATE_DAILY_XP_CAP` gains par
 * membre et par communauté sur 24 h glissantes, comptés dans le ledger (une soirée supprimée garde son gain, donc compte encore).
 * Une 4ᵉ soirée dans la journée ne rapporte plus d'XP de présence ; les soirées elles-mêmes ne sont pas limitées.
 */
export const PARTICIPATE_DAILY_XP_CAP = 3;

/**
 * Plafond anti-farm des gains « vote » (audit du 23/11/2026, constat 1.10) : `VOTE` rapportait 5 XP par proposition votée, et
 * rien ne limitait le nombre de propositions d'une soirée (un créateur en ajoutait N puis les votait). Valeur proposée, à valider :
 * au plus `VOTE_XP_CAP_PER_SESSION` gains `VOTE` par membre et par soirée, comptés dans le ledger (`XpEvent`, sourceId = id de la
 * proposition). Le 11ᵉ vote d'une soirée ne rapporte plus d'XP ; le vote lui-même reste enregistré. Le plafond de propositions par
 * soirée (`MAX_PROPOSALS_PER_SESSION`, src/lib/session-proposal-limit.ts) a la même valeur : une soirée normale ne l'atteint jamais.
 */
export const VOTE_XP_CAP_PER_SESSION = 10;

/**
 * Nombre de gains `VOTE` déjà versés pour une soirée. `sourceIds` = gains `VOTE` du membre créés depuis la création de la soirée ;
 * on retire ceux dont la proposition appartient à UNE AUTRE soirée (`proposalIdsOfOtherSessions`). Une proposition retirée (donc
 * absente de toute soirée) reste comptée : sinon « proposer, voter, retirer, recommencer » contournerait le plafond, la ligne du
 * ledger n'ayant pas de lien direct avec la soirée.
 */
export function countSessionVoteGains(sourceIds: readonly string[], proposalIdsOfOtherSessions: ReadonlySet<string>): number {
  return sourceIds.filter((id) => !proposalIdsOfOtherSessions.has(id)).length;
}

/** Gains plafonnés par membre sur `CREATE_SESSION_XP_WINDOW_MS`, par motif. */
export const DAILY_XP_CAPS = {
  CREATE_SESSION: CREATE_SESSION_DAILY_XP_CAP,
  PARTICIPATE: PARTICIPATE_DAILY_XP_CAP,
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
 * Titres FR par palier de niveau (ton « groupe de potes », auto-dérision en milieu de parcours seulement).
 *
 * Progression logique, du débutant au sommet, SANS régression de ton : un nouveau ne se fait jamais appeler « Noob » ni
 * « Victime » (audit de la production du 23/11/2026 : « Recrue » aux niveaux 1 à 4 puis « Noob » au niveau 5 sonnait
 * comme une rétrogradation, et « PAPED » ne voulait rien dire pour un nouveau). L’auto-dérision (« Try-hard », « No-life »)
 * arrive quand le joueur est déjà très investi et peut en rire.
 *
 * 1 Recrue → 5 Apprenti → 10 Habitué → 15 Confirmé → 20 Try-hard → 30 Vétéran → 40 Acharné → 50 No-life →
 * 70 Maître du jeu → 85 Légende vivante → 100 Immortel.
 */
export const LEVEL_TITLES: { level: number; title: string }[] = [
  { level: 1, title: "Recrue" },
  { level: 5, title: "Apprenti" },
  { level: 10, title: "Habitué" },
  { level: 15, title: "Confirmé" },
  { level: 20, title: "Try-hard" },
  { level: 30, title: "Vétéran" },
  { level: 40, title: "Acharné" },
  { level: 50, title: "No-life" },
  { level: 70, title: "Maître du jeu" },
  { level: 85, title: "Légende vivante" },
  { level: 100, title: "Immortel" },
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

/**
 * Vocabulaire UNIQUE de la progression XP (audit de la production du 23/11/2026 : l'accueil affichait « Niveau 4, 92 % » et
 * /tower « Niveau d'XP 1, 15 % », deux nombres pour la même personne). Le NIVEAU gagné avec l'XP s'appelle « Niveau d'XP »
 * partout ; le RANG (Bronze, Argent, Or, Platine, Diamant, Légende) regroupe des niveaux ; « Étage » est réservé à la Tour.
 */
export function xpLevelLabel(level: number): string {
  return `Niveau d’XP ${level}`;
}

/** Progression vers le niveau d'XP suivant : XP gagnée dans le niveau, XP nécessaire pour le franchir, fraction (0 à 1). */
export function levelProgress(xp: number) {
  const safe = Math.max(0, Math.floor(xp));
  const level = levelForXp(safe);
  const start = xpForLevel(level);
  const needed = xpForLevel(level + 1) - start;
  const earned = safe - start;
  return { level, earned, needed, remaining: needed - earned, fraction: needed > 0 ? Math.min(1, earned / needed) : 1 };
}

/** Rang suivant et XP restante pour l'atteindre ; `null` au rang maximal. */
export function rankProgress(xp: number) {
  const safe = Math.max(0, Math.floor(xp));
  const level = levelForXp(safe);
  const current = rankForLevel(level);
  const next = RANKS.find((rank) => rank.minLevel > current.minLevel) ?? null;
  if (!next) return { current, next: null, remaining: null, fraction: 1 };
  const start = xpForLevel(current.minLevel);
  const target = xpForLevel(next.minLevel);
  return { current, next, remaining: Math.max(0, target - safe), fraction: Math.min(1, Math.max(0, (safe - start) / (target - start))) };
}

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

/**
 * Montant final attribué pour une action XP — extrait de `awardXp` (fix
 * bug remonté, XP transactionnelle) pour rester testable sans Prisma.
 * `applyStreak = false` pour le backfill historique (le streak n'a pas de
 * sens pour de l'XP reconstruite après coup) — même contrat qu'avant.
 */
export function computeAwardedAmount(
  baseAmount: number,
  streakCount: number,
  applyStreak: boolean
): number {
  const multiplier = applyStreak ? streakMultiplier(streakCount) : 1;
  return Math.round(baseAmount * multiplier);
}

/**
 * Un gain d'XP a-t-il fait franchir un palier de niveau ? Extrait de
 * `awardXp` (fix bug remonté, XP transactionnelle) — l'appelant doit
 * fournir `beforeXpTotal` dérivé du résultat de l'incrément atomique
 * (`updated.xpTotal - amount`), jamais d'une lecture séparée faite avant
 * l'écriture (fenêtre de course sous gains XP simultanés).
 */
export function didLevelUp(beforeXpTotal: number, afterXpTotal: number): boolean {
  return levelForXp(afterXpTotal) > levelForXp(beforeXpTotal);
}
