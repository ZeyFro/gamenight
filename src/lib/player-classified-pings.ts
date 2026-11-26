import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Ping de rôle de jeu des annonces « recherche de joueurs » : opt-in via le rôle
 * du jeu (voir `buildGameRolePing`), plafonné à 3 par joueur et par jour.
 *
 * Le compteur est consommé AVANT l'enqueue du relais. La consommation est
 * atomique (`INSERT ... ON CONFLICT ... WHERE count < 3`) : deux annonces
 * simultanées du même joueur ne peuvent jamais dépasser le plafond.
 */
export const PLAYER_CLASSIFIED_DAILY_PINGS = 3;

export function playerClassifiedPingDay(now: Date): Date {
  // Le plafond est quotidien pour les joueurs : le jour se lit à Paris, jamais en UTC
  // (23 h 30 UTC restent le même jour pour un joueur français).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
}

export async function consumePlayerClassifiedPing(input: {
  communityId: string;
  userId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const day = playerClassifiedPingDay(now);
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "PlayerClassifiedPing"
        ("id", "communityId", "userId", "day", "count", "createdAt", "updatedAt")
      VALUES
        (${randomUUID()}, ${input.communityId}, ${input.userId}, ${day}, 1, ${now}, ${now})
      ON CONFLICT ("communityId", "userId", "day")
      DO UPDATE SET
        "count" = "PlayerClassifiedPing"."count" + 1,
        "updatedAt" = ${now}
      WHERE "PlayerClassifiedPing"."count" < ${PLAYER_CLASSIFIED_DAILY_PINGS}
      RETURNING "count"
    `;
    return rows.length > 0;
  } catch (error) {
    // Table absente (migration pas encore appliquée) : aucun ping, jamais un
    // blocage de la création d'annonce.
    logger.warn("player-classified-pings", "Compteur de pings indisponible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
