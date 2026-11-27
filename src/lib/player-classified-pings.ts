import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Ping de rôle de jeu des annonces « recherche de joueurs » : opt-in via le rôle du jeu (voir `buildGameRolePing`), plafonné à 3 PAR JOUEUR
 * ET PAR JOUR, toutes communautés confondues (D3/D10). Le compteur est tenu par (communauté, joueur, jour) mais le plafond se calcule sur la
 * SOMME des communautés du jour de Paris.
 *
 * Atomicité sans migration : un verrou advisory TRANSACTIONNEL sur le joueur sérialise les consommations simultanées (même sur deux
 * serveurs), puis la somme du jour est lue et le compteur de la communauté incrémenté dans la même transaction.
 *
 * `now` est un VRAI instant (`new Date()`), jamais l'heure murale de `wallClockNow()` (heure de Paris encodée en UTC) : la convertir une
 * seconde fois vers Europe/Paris décalerait le jour d'une à deux heures.
 */
export const PLAYER_CLASSIFIED_DAILY_PINGS = 3;

export function playerClassifiedPingDay(now: Date): Date {
  // Le plafond est quotidien pour les joueurs : le jour se lit à Paris, jamais en UTC. Le jour change à MINUIT DE PARIS : 22 h 59 UTC
  // (hiver) est encore la veille, 23 h 00 UTC est le lendemain ; l'été (UTC+2) la bascule est à 22 h 00 UTC.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
}

export async function consumePlayerClassifiedPing(input: {
  communityId: string;
  userId: string;
  /** VRAI instant (jamais l'heure murale). */
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const day = playerClassifiedPingDay(now);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"player-classified-ping:" + input.userId}))`;
      const [{ total }] = await tx.$queryRaw<Array<{ total: number }>>`
        SELECT COALESCE(SUM("count"), 0)::int AS total FROM "PlayerClassifiedPing"
        WHERE "userId" = ${input.userId} AND "day" = ${day}
      `;
      if (total >= PLAYER_CLASSIFIED_DAILY_PINGS) return false;
      await tx.$executeRaw`
        INSERT INTO "PlayerClassifiedPing" ("id", "communityId", "userId", "day", "count", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${input.communityId}, ${input.userId}, ${day}, 1, ${now}, ${now})
        ON CONFLICT ("communityId", "userId", "day")
        DO UPDATE SET "count" = "PlayerClassifiedPing"."count" + 1, "updatedAt" = ${now}
      `;
      return true;
    }, { timeout: 5000, maxWait: 5000 });
  } catch (error) {
    // Table absente (migration pas encore appliquée) ou base indisponible : aucun ping, jamais un blocage du relais.
    logger.warn("player-classified-pings", "Compteur de pings indisponible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
