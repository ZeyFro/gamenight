import { prisma } from "@/lib/prisma";
import { provisionCommunityFromGuild } from "@/lib/community-provisioning";

/**
 * Multi-communautés, PR6 — activation d'une communauté par la commande Discord
 * `/gamenight setup` (aucune validation manuelle). L'appelant a déjà vérifié la
 * signature de l'interaction ET la permission `MANAGE_GUILD` du membre.
 * Idempotent et sans course : le passage à ACTIVE est un `updateMany`
 * conditionnel sur le statut. SUSPENDED et ARCHIVED ne se contournent jamais.
 * Aucun Membership n'est créé ici : il naît à la connexion (PR1).
 */

export type SetupAction = "activated" | "already_active" | "blocked";

export interface SetupResult {
  action: SetupAction;
  communityId: string | null;
}

const NON_REACTIVABLE = new Set(["SUSPENDED", "ARCHIVED"]);

export async function setupCommunityFromGuild(guildId: string, invokerDiscordId: string): Promise<SetupResult> {
  if (!/^\d+$/.test(guildId)) throw new Error("setupCommunityFromGuild : identifiant de serveur invalide.");

  const existing = await prisma.community.findUnique({
    where: { discordGuildId: guildId },
    select: { id: true, status: true },
  });
  if (existing?.status === "ACTIVE") return { action: "already_active", communityId: existing.id };
  if (existing && NON_REACTIVABLE.has(existing.status)) return { action: "blocked", communityId: existing.id };

  let communityId = existing?.id;
  if (!communityId) {
    // Le payload de l'interaction ne porte pas le nom du serveur : nom provisoire,
    // corrigé par la synchronisation des serveurs (`community-guild-sync`).
    const created = await provisionCommunityFromGuild(
      { id: guildId, name: `Serveur ${guildId.slice(-6)}`, icon: null },
      invokerDiscordId
    );
    if (created.action === "ignored") return { action: "blocked", communityId: created.communityId };
    communityId = created.communityId;
  }

  const activator = await prisma.user.findUnique({ where: { discordId: invokerDiscordId }, select: { id: true } });
  const { count } = await prisma.community.updateMany({
    where: { id: communityId, status: { in: ["PENDING", "LEFT"] } },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedById: activator?.id ?? null, leftAt: null },
  });
  if (count === 1) return { action: "activated", communityId };

  // Un appel concurrent a changé le statut entre la lecture et l'écriture.
  const current = await prisma.community.findUnique({ where: { id: communityId }, select: { status: true } });
  return { action: current?.status === "ACTIVE" ? "already_active" : "blocked", communityId };
}
