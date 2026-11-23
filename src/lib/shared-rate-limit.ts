import { prisma } from "@/lib/prisma";
import { checkRateLimit, type RateLimitOptions } from "@/lib/rate-limit";

/**
 * Limitation de débit PARTAGÉE entre les serveurs Vercel (contrôle de sécurité T2) : la limite en mémoire de
 * `checkRateLimit` est propre à chaque instance et se contourne en partie quand plusieurs instances tournent.
 * Réservée aux actions sensibles (une écriture en base par appel) : suppression et export de compte, reconnexion
 * forcée, enregistrement des commandes Discord.
 *
 * Fenêtre fixe alignée (`windowStart` = début de fenêtre), compteur incrémenté atomiquement par
 * `INSERT … ON CONFLICT DO UPDATE` : deux instances simultanées ne dépassent jamais la limite. La limite en
 * mémoire reste appliquée d'abord (elle évite l'écriture quand une instance est déjà saturée).
 *
 * Base indisponible : l'erreur remonte (l'action sensible a de toute façon besoin de la base) ; jamais avalée.
 */
export function rateLimitWindowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

export async function checkSharedRateLimit(
  userId: string,
  action: string,
  { limit = 10, windowMs = 60_000 }: RateLimitOptions = {},
  now = Date.now(),
): Promise<boolean> {
  if (!checkRateLimit(userId, action, { limit, windowMs })) return false;
  const key = `${action}:${userId}`.slice(0, 255);
  const windowStart = rateLimitWindowStart(now, windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitWindow" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitWindow"."count" + 1
    RETURNING "count"
  `;
  // Nettoyage borné : seules les fenêtres expirées de cette même clé (clé primaire).
  await prisma.$executeRaw`DELETE FROM "RateLimitWindow" WHERE "key" = ${key} AND "windowStart" < ${windowStart}`;
  return (rows[0]?.count ?? Number.POSITIVE_INFINITY) <= limit;
}
