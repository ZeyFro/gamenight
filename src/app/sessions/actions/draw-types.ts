/**
 * Types + état initial partagés entre l'action serveur
 * (`draw.ts`, `"use server"`) et le dialog client
 * (`DrawSessionGameDialog.tsx`) — extrait dans un module SANS `"use server"`
 * car un fichier `"use server"` ne peut exporter QUE des fonctions async
 * (contrainte Next.js) : `INITIAL_DRAW_STATE`, une simple constante, n'y a
 * pas sa place.
 */
export type DrawSessionGameCandidate = { id: string; name: string; coverUrl: string | null };

export type DrawSessionGameActionState =
  | { status: "idle" }
  | {
      status: "drawn";
      winnerGameId: string;
      winnerGameName: string;
      winnerGameCoverUrl: string | null;
      /** Même ordre que le tirage serveur (`jouableProposals`, trié par
       * ancienneté de proposition) — l'animation cliente doit cibler
       * l'INDEX du gagnant dans CETTE liste, jamais une liste reconstruite
       * différemment côté client. */
      candidates: DrawSessionGameCandidate[];
    }
  | { status: "no_eligible_game" }
  /** Soirée déjà décidée/annulée par un autre chemin (clôture manuelle,
   * clôture automatique, double clic, deuxième onglet, annulation) —
   * jamais une erreur : `revalidatePath` (dans l'action) suffit à ce que
   * la page /sessions/[id] elle-même affiche l'état RÉEL au prochain
   * rendu, ce dialog n'a besoin que d'un message générique renvoyant
   * vers elle. */
  | { status: "already_decided" }
  | { status: "error" };

export const INITIAL_DRAW_STATE: DrawSessionGameActionState = { status: "idle" };
