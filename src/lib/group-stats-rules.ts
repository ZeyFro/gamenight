import { plural } from "@/lib/plural";

/**
 * Chiffres du groupe : règles PURES partagées par l'accueil, Potes et le classement (audit de la production du 23/11/2026 :
 * « 18 soirées jouées / 5 joueurs actifs » puis « 0 / 0 » avec « Deadlock · 8 fois » ; Potes « 8 membres », classement 9, dispos /9,
 * base 10 comptes). Définitions UNIQUES :
 * - « membres » = les membres ACTIFS du serveur affiché, TOI COMPRIS (classement, calendrier, bibliothèque : 9) ;
 * - « autres membres » = les membres sans toi (Potes : 8, car ta propre carte n'y figure pas) ;
 * - « comptes en base » (10) comprend des comptes sans serveur actif (anciens membres, administrateur seul) : jamais affiché.
 */
export interface RawGroupStats {
  totalSessionsPlayed: number;
  mostPlayedCount: number | null;
  activePlayers: number;
}

export interface CoherentGroupStats {
  totalSessionsPlayed: number;
  activePlayers: number;
  /** Les compteurs de soirées étaient en retard sur ceux des jeux : le total a été relevé au plus petit nombre possible. */
  sessionsRaisedToGameCount: boolean;
}

/**
 * Un jeu ne peut pas avoir été joué plus de fois qu'il n'y a eu de soirées : si le compteur de soirées (`GroupSessionStats`) est
 * plus petit que celui du jeu le plus joué (`GroupGameStat`), il est en retard (ligne absente ou remise à zéro) ; on affiche alors
 * au moins ce plus petit nombre cohérent plutôt que « 0 soirée jouée » à côté de « Deadlock · 8 fois ». Les joueurs actifs ne
 * dépassent jamais le nombre de membres.
 */
export function reconcileGroupStats(raw: RawGroupStats, members: number): CoherentGroupStats {
  const sessions = Math.max(0, Math.floor(raw.totalSessionsPlayed));
  const gameCount = Math.max(0, Math.floor(raw.mostPlayedCount ?? 0));
  const raised = gameCount > sessions;
  return {
    totalSessionsPlayed: raised ? gameCount : sessions,
    activePlayers: Math.min(Math.max(0, Math.floor(raw.activePlayers)), Math.max(0, members)),
    sessionsRaisedToGameCount: raised,
  };
}

/** « 9 membres actifs » (toi compris). */
export function membersLabel(members: number): string {
  return `${members} ${plural(members, "membre")} ${plural(members, "actif")}`;
}

/** « 8 autres membres » : la liste Potes ne montre pas ta propre carte. */
export function otherMembersLabel(others: number): string {
  return `${others} ${plural(others, "autre")} ${plural(others, "membre")}`;
}

/** Légende de l'accueil : « 5 joueurs actifs sur 9 membres (vus ces 7 derniers jours) ». */
export function activePlayersCaption(active: number, members: number): string {
  return `${active} ${plural(active, "joueur")} ${plural(active, "actif")} sur ${members} ${plural(members, "membre")} (vus ces 7 derniers jours)`;
}
