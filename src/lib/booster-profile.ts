import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { readBoosterStatus } from "@/lib/discord-boost";

/**
 * Statut Booster tel que le PROFIL GameNight peut l'afficher.
 *
 * Règle de sécurité : l'identité Discord et le serveur sont relus en base à
 * partir de l'utilisateur de la session serveur. Aucune valeur envoyée par le
 * navigateur (cookie de préférence, champ de formulaire, paramètre d'URL) n'est
 * acceptée : un membre ne peut pas s'attribuer la distinction.
 *
 * Trois silences volontaires, tous rendus « aucune distinction » :
 * - fonctionnalité fermée (`DISCORD_BOOSTER_ENABLED` absent ou jeton manquant) :
 *   aucun appel Discord n'est tenté ;
 * - Discord injoignable ou trop lent : `UNKNOWN`, jamais « tu ne boosts pas » ;
 * - membre ou communauté non résolus : `UNKNOWN`.
 *
 * Aucune écriture, aucune table, aucun cache : le statut est toujours celui de
 * Discord à l'instant du rendu, et il disparaît dès que le boost s'arrête.
 */
export type ViewerBoosterState =
  | { kind: "DISABLED" }
  | { kind: "ACTIVE"; since: string | null }
  | { kind: "INACTIVE" }
  | { kind: "UNKNOWN" };

/**
 * Budget court : le profil est une page, pas une commande différée. Au-delà,
 * la page s'affiche sans distinction plutôt que d'attendre Discord.
 */
export const PROFILE_BOOSTER_BUDGET_MS = 1_200;

export function boosterFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_BOOSTER_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN);
}

export async function loadViewerBoosterState(input: {
  userId: string;
  communityId: string;
}): Promise<ViewerBoosterState> {
  // Soutiens Nitro (DISCORD_BOOSTERS_ENABLED) : état tenu par le cron REST, sans appel Discord.
  const { readStoredBoosterState } = await import("@/lib/booster-support");
  const stored = await readStoredBoosterState(input);
  if (stored?.boosting) return { kind: "ACTIVE", since: stored.since ? stored.since.toISOString() : null };
  if (!boosterFeatureEnabled()) return { kind: "DISABLED" };

  const [user, community] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { discordId: true } }),
    prisma.community.findUnique({
      where: { id: input.communityId },
      select: { discordGuildId: true, status: true },
    }),
  ]);
  if (!user?.discordId || !community?.discordGuildId || community.status !== "ACTIVE") {
    return { kind: "UNKNOWN" };
  }

  try {
    const status = await readBoosterStatus({
      guildId: community.discordGuildId,
      discordId: user.discordId,
      budgetMs: PROFILE_BOOSTER_BUDGET_MS,
    });
    if (status.status === "ACTIVE") return { kind: "ACTIVE", since: status.since };
    return status.status === "INACTIVE" ? { kind: "INACTIVE" } : { kind: "UNKNOWN" };
  } catch (error) {
    logger.warn("booster-profile", "Statut Booster indisponible pour le profil.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { kind: "UNKNOWN" };
  }
}
