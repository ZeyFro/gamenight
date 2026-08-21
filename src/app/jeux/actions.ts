"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getGameDetails } from "@/lib/game-details";

/** Bouton "Rafraîchir les infos" de la fiche jeu : ignore le cache IGDB existant. */
export async function refreshGameDetails(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) return;

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return;

  await getGameDetails(game, { forceRefresh: true });
  revalidatePath(`/jeux/${gameId}`);
}
