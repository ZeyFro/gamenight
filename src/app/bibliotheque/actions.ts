"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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

export type ToVerifierMode = "coop" | "multi" | "solo";

/**
 * Onglet "À vérifier" (PR 32.6, Bloc B) — toggle rapide sur un jeu encore
 * non vérifié (`isCoop=false && playInfoManual=false`). Les 3 modes
 * traduisent le choix humain en `isCoop`/`minPlayers`/`maxPlayers` :
 * - "coop" : confirmé coop, on ne touche pas aux bornes de joueurs
 *   existantes (peuvent déjà être correctes via Steam/IGDB, seul `isCoop`
 *   manquait).
 * - "solo" : jeu solo uniquement, bornes forcées à 1–1.
 * - "multi" : multijoueur non-coop confirmé ; si les bornes actuelles
 *   laissent croire à du solo (`maxPlayers` absent ou ≤ 1), on les relève
 *   à une valeur par défaut plausible (2–4) plutôt que de laisser une
 *   contradiction "multijoueur" + "1 joueur max" — sinon on garde les
 *   bornes déjà connues.
 * Dans tous les cas `playInfoManual: true` : protège le choix humain du
 * prochain backfill IGDB/Steam Store.
 */
export async function setToVerifierGamePlayInfo(
  gameId: string,
  mode: ToVerifierMode
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  const owns = await prisma.userGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId } },
  });
  if (!owns) return { ok: false };

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return { ok: false };

  const data =
    mode === "coop"
      ? { isCoop: true, playInfoManual: true }
      : mode === "solo"
        ? { isCoop: false, minPlayers: 1, maxPlayers: 1, playInfoManual: true }
        : {
            isCoop: false,
            playInfoManual: true,
            minPlayers: game.minPlayers && game.minPlayers > 1 ? game.minPlayers : 2,
            maxPlayers: game.maxPlayers && game.maxPlayers > 1 ? game.maxPlayers : 4,
          };

  await prisma.game.update({ where: { id: gameId }, data });

  revalidatePath("/bibliotheque");
  revalidatePath("/bibliotheque/a-verifier");
  revalidatePath("/bibliotheque/groupe");
  revalidatePath("/tierlist");
  return { ok: true };
}

/**
 * Bouton "Ignorer" de l'onglet "À vérifier" : confirme les valeurs
 * actuelles telles quelles (pas de changement d'`isCoop`/joueurs), marque
 * simplement `playInfoManual: true` pour que le jeu ne réapparaisse plus
 * dans la file, même si aucune correction n'était nécessaire.
 */
export async function ignoreToVerifierGame(gameId: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  const owns = await prisma.userGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId } },
  });
  if (!owns) return { ok: false };

  await prisma.game.update({
    where: { id: gameId },
    data: { playInfoManual: true },
  });

  revalidatePath("/bibliotheque");
  revalidatePath("/bibliotheque/a-verifier");
  revalidatePath("/bibliotheque/groupe");
  revalidatePath("/tierlist");
  return { ok: true };
}

/**
 * Bonus de l'onglet `/bibliotheque` (PR 32.6, Bloc B) : quand le filtre
 * "Coop" est le seul filtre de mode actif, permet de confirmer d'un coup
 * tous les jeux actuellement affichés comme coop — utile après un
 * backfill partiel où l'utilisateur repère visuellement une liste déjà
 * correcte. Restreint aux jeux possédés par l'utilisateur (pas de
 * confiance sur la liste d'ids reçue du client).
 */
export async function batchMarkGamesCoop(gameIds: string[]): Promise<{ count: number }> {
  const user = await getCurrentUser();
  if (!user) return { count: 0 };
  if (gameIds.length === 0) return { count: 0 };

  const owned = await prisma.userGame.findMany({
    where: { userId: user.id, gameId: { in: gameIds }, owned: true },
    select: { gameId: true },
  });
  const ownedIds = owned.map((o) => o.gameId);
  if (ownedIds.length === 0) return { count: 0 };

  const result = await prisma.game.updateMany({
    where: { id: { in: ownedIds } },
    data: { isCoop: true, playInfoManual: true },
  });

  revalidatePath("/bibliotheque");
  revalidatePath("/bibliotheque/a-verifier");
  revalidatePath("/bibliotheque/groupe");
  revalidatePath("/tierlist");
  return { count: result.count };
}
