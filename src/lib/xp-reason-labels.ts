import type { XpReason } from "@prisma/client";

/** Libellés français des motifs d'XP (profil du joueur, historique de l'onglet « Joueurs » de /admin). */
export const XP_REASON_LABELS: Record<XpReason, string> = {
  CREATE_SESSION: "a créé une soirée",
  VOTE: "a voté pour un jeu",
  PARTICIPATE: "a participé à une soirée",
  AVAILABILITY_FIRST: "a réglé ses disponibilités",
  STEAM_LINK_FIRST: "a lié son compte Steam",
  SESSION_RESULT: "a reçu un bonus de résultats",
  SESSION_ATTENDANCE: "a été présent à une soirée",
  SESSION_ABSENCE: "a été absent d'une soirée",
  SUPERLATIVE_AWARD: "a gagné une récompense",
  BADGE_UNLOCKED: "a débloqué un badge",
  CHALLENGE_COMPLETE: "a complété le défi de la semaine",
  PRONOSTIC_CORRECT: "a fait un pronostic correct",
  XP_BET_WON: "a gagné un pari d'XP",
  TOURNAMENT_RESULT: "a marqué en tournoi",
  SHOP_PURCHASE: "a acheté un cosmétique",
  ADMIN_ADJUSTMENT: "a reçu une correction d'un admin",
};
