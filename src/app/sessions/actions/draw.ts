"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { drawSessionGame } from "@/lib/sessions";
import type { DrawSessionGameActionState, DrawSessionGameCandidate } from "./draw-types";

/**
 * V2 — confirme le tirage au sort d'un jeu pour une soirée existante
 * (remplace le parcours cassé "soirée → roulette", voir
 * `drawSessionGame`, sessions.ts, pour les règles d'éligibilité/tirage
 * et les garanties de concurrence). Autorisation créateur re-vérifiée
 * ICI, côté serveur, à CHAQUE appel — jamais seulement en masquant le
 * bouton côté client (`drawSessionGame` revérifie aussi
 * `createdById === actorId`, double garde intentionnelle).
 *
 * Ne prend AUCUNE préférence de jeu en entrée (seulement `sessionId`) :
 * le résultat est entièrement déterminé et commité côté serveur avant
 * même que cette fonction ne retourne — jamais un `gameId` choisi par le
 * client. Les noms/couvertures des jeux (gagnant + candidats pour
 * l'animation) sont relus ICI, APRÈS le commit, plutôt que réutilisés
 * depuis un aperçu côté client potentiellement périmé (une proposition
 * peut avoir changé entre l'ouverture du dialogue et la confirmation).
 */
export async function drawSessionGameAction(
  _prevState: DrawSessionGameActionState,
  formData: FormData
): Promise<DrawSessionGameActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "drawSessionGame")) return { status: "error" };

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return { status: "error" };

  const outcome = await drawSessionGame(sessionId, user.id);

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");

  if (outcome.kind === "not_found" || outcome.kind === "not_creator") {
    // Ne devrait jamais survenir depuis l'UI (bouton créateur-only, id
    // caché valide) — une requête forgée ou une course de suppression
    // retombe ici sans jamais exposer de détail ni planter.
    return { status: "error" };
  }
  if (outcome.kind === "not_voting") return { status: "already_decided" };
  if (outcome.kind === "no_eligible_game") return { status: "no_eligible_game" };

  const games = await prisma.game.findMany({
    where: { id: { in: outcome.candidateGameIds } },
    select: { id: true, name: true, coverUrl: true },
  });
  const gameById = new Map(games.map((g) => [g.id, g]));
  const candidates: DrawSessionGameCandidate[] = outcome.candidateGameIds
    .map((id) => gameById.get(id))
    .filter((g): g is (typeof games)[number] => g !== undefined)
    .map((g) => ({ id: g.id, name: g.name, coverUrl: g.coverUrl }));
  const winnerGame = gameById.get(outcome.winnerGameId);

  return {
    status: "drawn",
    winnerGameId: outcome.winnerGameId,
    winnerGameName: winnerGame?.name ?? "?",
    winnerGameCoverUrl: winnerGame?.coverUrl ?? null,
    candidates,
  };
}
