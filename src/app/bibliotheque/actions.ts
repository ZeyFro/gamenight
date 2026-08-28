"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getGameDetails } from "@/lib/game-details";

/**
 * Enrichissement IGDB à la demande (PR 32, 2.5/4 — Bug 2B) : déclenché
 * côté client quand le filtre "Coop" est actif et que la biblio contient
 * des jeux sans cache IGDB (`igdbDetails` jamais fetché — typiquement
 * des jeux importés depuis Steam, jamais visités sur leur fiche). Chaque
 * appel à `getGameDetails` fetch IGDB, met en cache `igdbDetails`, et
 * synchronise `isCoop`/`maxPlayers` en passant (voir
 * `computePlayInfoFromIgdb` dans `src/lib/game-details.ts`) — c'est cette
 * synchronisation qui corrige le filtre Coop pour ces jeux, pas un
 * mécanisme séparé.
 */
export async function enrichGamesForCoopFilter(gameIds: string[]): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const games = await prisma.game.findMany({ where: { id: { in: gameIds } } });

  for (const game of games) {
    try {
      await getGameDetails(game);
    } catch (error) {
      console.error(
        `[bibliotheque] Échec d'enrichissement IGDB à la demande pour ${game.id}`,
        error
      );
    }
  }
}
