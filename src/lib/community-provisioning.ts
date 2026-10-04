import type { Community } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Multi-communautés, PR2 — création automatique d'une communauté quand le bot
 * est ajouté à un serveur Discord (webhook `APPLICATION_AUTHORIZED` ou cron
 * `GET /users/@me/guilds`). Une nouvelle communauté démarre TOUJOURS en
 * `PENDING` : aucun accès ni Membership avant l'activation par un admin.
 * Idempotent : webhook et cron peuvent se croiser sans doublon.
 */

export interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
}

export type ProvisionAction = "created" | "updated" | "unchanged" | "reset_pending" | "ignored";

export interface ProvisionResult {
  action: ProvisionAction;
  communityId: string;
}

const SLUG_BASE_MAX = 40;

/**
 * Segment d'URL `/c/[slug]/…` : nom normalisé (ASCII minuscule) + fin de l'id du
 * serveur, qui suffit à l'unicité en pratique. Jamais `default` (réservé : le
 * suffixe numérique est toujours présent). `full` ajoute l'id complet, pour le
 * cas rarissime d'une collision.
 */
export function communitySlug(name: string, guildId: string, full = false): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_BASE_MAX)
      .replace(/-+$/g, "") || "serveur";
  return `${base}-${full ? guildId : guildId.slice(-6)}`;
}

const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "P2002";

async function reconcileExisting(existing: Community, guild: GuildInfo): Promise<ProvisionResult> {
  // Suspension et archivage ne se contournent pas en réajoutant le bot.
  if (existing.status === "SUSPENDED" || existing.status === "ARCHIVED") {
    return { action: "ignored", communityId: existing.id };
  }
  if (existing.status === "LEFT") {
    // Bot réajouté : il faut qu'un admin réactive la communauté.
    await prisma.community.update({
      where: { id: existing.id },
      data: { name: guild.name, iconHash: guild.icon, status: "PENDING", leftAt: null },
    });
    return { action: "reset_pending", communityId: existing.id };
  }
  if (existing.name === guild.name && existing.iconHash === guild.icon) {
    return { action: "unchanged", communityId: existing.id };
  }
  await prisma.community.update({
    where: { id: existing.id },
    data: { name: guild.name, iconHash: guild.icon },
  });
  return { action: "updated", communityId: existing.id };
}

export async function provisionCommunityFromGuild(
  guild: GuildInfo,
  installedByDiscordId: string | null
): Promise<ProvisionResult> {
  if (!/^\d+$/.test(guild.id)) throw new Error("provisionCommunityFromGuild : identifiant de serveur invalide.");

  const findByGuild = () => prisma.community.findUnique({ where: { discordGuildId: guild.id } });
  const existing = await findByGuild();
  if (existing) return reconcileExisting(existing, guild);

  let lastError: unknown;
  for (const full of [false, true]) {
    try {
      const created = await prisma.community.create({
        data: {
          slug: communitySlug(guild.name, guild.id, full),
          name: guild.name,
          discordGuildId: guild.id,
          iconHash: guild.icon,
          status: "PENDING",
          installedByDiscordId,
        },
      });
      return { action: "created", communityId: created.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Soit un appel concurrent vient de créer ce serveur (on relit sa
      // ligne), soit le slug est pris par un autre serveur (on réessaie avec
      // l'id complet).
      const winner = await findByGuild();
      if (winner) return reconcileExisting(winner, guild);
      lastError = error;
    }
  }
  throw lastError;
}
