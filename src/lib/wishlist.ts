import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { fetchSteamStoreDetails } from "@/lib/steam-store";
import { logger } from "@/lib/logger";

export interface WishlistEntryDTO {
  id: string;
  gameId: string;
  gameName: string;
  coverUrl: string | null;
  steamAppId: number | null;
  reason: string | null;
  createdAt: Date;
  proposedByName: string;
  purchasedByName: string | null;
  interestedCount: number;
  notInterestedCount: number;
  myVote: boolean | null;
}

/**
 * Sprint 5 (FEATURE 3, Wishlist) — toutes les entrées, triées par nombre
 * d'intéressés décroissant (cf. spec). Le prix Steam n'est PAS inclus ici
 * (fetch live best-effort séparé, cf. `enrichWithPrices`) : cette
 * fonction reste une simple lecture DB, rapide et sans dépendance
 * réseau.
 */
export async function getWishlist(currentUserId: string): Promise<WishlistEntryDTO[]> {
  const entries = await prisma.gameWishlist.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      game: { select: { id: true, name: true, coverUrl: true, steamAppId: true } },
      proposedBy: { select: { discordName: true } },
      purchasedBy: { select: { discordName: true } },
      votes: { select: { userId: true, interested: true } },
    },
  });

  const mapped = entries.map((e) => ({
    id: e.id,
    gameId: e.game.id,
    gameName: e.game.name,
    coverUrl: e.game.coverUrl,
    steamAppId: e.game.steamAppId,
    reason: e.reason,
    createdAt: e.createdAt,
    proposedByName: e.proposedBy.discordName,
    purchasedByName: e.purchasedBy?.discordName ?? null,
    interestedCount: e.votes.filter((v) => v.interested).length,
    notInterestedCount: e.votes.filter((v) => !v.interested).length,
    myVote: e.votes.find((v) => v.userId === currentUserId)?.interested ?? null,
  }));

  return mapped.sort((a, b) => b.interestedCount - a.interestedCount);
}

/**
 * Prix Steam best-effort (fetch live, jamais mis en cache — le prix
 * change, contrairement à `Game.igdbDetails`) pour les entrées qui ont
 * un `steamAppId` et ne sont pas déjà marquées achetées. En parallèle,
 * chaque échec individuel est ignoré (`priceFormatted: null`) plutôt que
 * de faire échouer toute la page.
 */
export async function enrichWithPrices(
  entries: WishlistEntryDTO[]
): Promise<Map<string, string | null>> {
  const prices = new Map<string, string | null>();
  await Promise.all(
    entries
      .filter((e) => e.steamAppId && !e.purchasedByName)
      .map(async (e) => {
        try {
          const details = await fetchSteamStoreDetails(e.steamAppId!);
          prices.set(e.id, details?.priceFormatted ?? null);
        } catch {
          logger.warn("wishlist", "Steam Store injoignable pour un prix wishlist.", {
            gameId: e.gameId,
          });
          prices.set(e.id, null);
        }
      })
  );
  return prices;
}

/**
 * Appelée après chaque import Steam réussi (`importSteamLibrary`, cron
 * ET réimport manuel) — dès qu'un membre possède désormais un jeu de la
 * wishlist, l'entrée est marquée "achetée" toute seule (spec : "détecté
 * via le cron Steam existant"). Best-effort par entrée, comme les autres
 * boucles cron de l'app.
 */
export async function checkWishlistPurchases(userId: string): Promise<void> {
  const ownedGameIds = new Set(
    (
      await prisma.userGame.findMany({
        where: { userId, owned: true },
        select: { gameId: true },
      })
    ).map((ug) => ug.gameId)
  );
  if (ownedGameIds.size === 0) return;

  const pending = await prisma.gameWishlist.findMany({
    where: { purchasedById: null, gameId: { in: [...ownedGameIds] } },
    select: { id: true },
  });
  if (pending.length === 0) return;

  await prisma.gameWishlist.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { purchasedById: userId, purchasedAt: wallClockNow() },
  });
}
