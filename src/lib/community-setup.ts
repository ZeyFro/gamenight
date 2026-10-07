import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { provisionCommunityFromGuild } from "@/lib/community-provisioning";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";
import { createSetupChannel, getSetupBot, getSetupGuild, listSetupChannels, type DiscordRestResult, type SetupChannel } from "@/lib/discord-rest";
import { BOT_CHANNEL_PERMISSIONS, MEMBER_CHANNEL_DENY, MEMBER_CHANNEL_PERMISSIONS, channelPermissions, missingSetupPermissions } from "@/lib/discord-setup-permissions";

export type SetupAction = "activated" | "already_active" | "blocked" | "in_progress" | "incomplete";
export interface SetupResult { action: SetupAction; communityId: string | null; message?: string }
class SetupError extends Error {}
const NON_REACTIVABLE = new Set(["SUSPENDED", "ARCHIVED"]);
function requireDiscord<T>(result: DiscordRestResult<T>): T {
  if (!result.ok) throw new SetupError(`Discord : ${result.message} Relance /gamenight setup après correction.`);
  return result.data;
}

/** Durable creation fence in the existing named-lock table (no migration).
 * After a crash/lost POST response, discovery clears it; never blindly repeat.
 */
async function discoverOrCreate(guildId: string, slot: string, found: SetupChannel | undefined, channel: Omit<SetupChannel, "id" | "guild_id">, deadline: Date): Promise<SetupChannel> {
  const name = `community-setup-create:${guildId}:${slot}`;
  if (found) {
    await prisma.cronLock.deleteMany({ where: { name } });
    return found;
  }
  const token = randomUUID();
  await prisma.cronLock.createMany({ data: [{ name }], skipDuplicates: true });
  const claim = await prisma.cronLock.updateMany({ where: { name, lockedAt: null }, data: { lockedAt: new Date(), token } });
  if (!claim.count) throw new SetupError(`Création de ${channel.name} encore incertaine. Relance setup pour retrouver le salon. S’il reste absent, contacte un admin GameNight pour vérifier la tentative avant de la réarmer.`);
  const result = await createSetupChannel({ guildId, channel, deadline });
  if (!result.ok) {
    if (result.kind !== "network_uncertain" && result.kind !== "server_error") {
      await prisma.cronLock.deleteMany({ where: { name, token } });
    }
    requireDiscord(result);
  }
  const created = requireDiscord(result);
  await prisma.cronLock.deleteMany({ where: { name, token } });
  return created;
}

export async function setupCommunityFromGuild(guildId: string, invokerDiscordId: string): Promise<SetupResult> {
  if (!/^\d{1,20}$/.test(guildId)) throw new Error("Identifiant de serveur invalide.");
  const lockName = `community-setup:${guildId}`;
  await prisma.cronLock.createMany({ data: [{ name: lockName }], skipDuplicates: true });
  // Route maxDuration=120 s; lease=180 s; work budget=90 s.
  const lock = await acquireCronLock(lockName, 180_000);
  if (!lock.acquired) return { action: "in_progress", communityId: null, message: "Une installation est déjà en cours sur ce serveur. Relance setup dans un instant." };
  let communityId: string | null = null;
  try {
    // Attach the historical row only to its own configured guild if still empty.
    if (process.env.DISCORD_BOT_GUILD_ID?.trim() === guildId) {
      await prisma.community.updateMany({
        where: { slug: DEFAULT_COMMUNITY_SLUG, discordGuildId: null },
        data: { discordGuildId: guildId },
      });
    }
    const existing = await prisma.community.findUnique({ where: { discordGuildId: guildId } });
    communityId = existing?.id ?? null;
    if (existing && NON_REACTIVABLE.has(existing.status)) return { action: "blocked", communityId };
    const deadline = new Date(Date.now() + 90_000);
    const guild = requireDiscord(await getSetupGuild({ guildId, deadline }));
    if (guild.id !== guildId) throw new SetupError("Discord a retourné un autre serveur : installation refusée.");
    // ACTIVE and default also refresh; slugs, memberships and XP are preserved.
    const provisioned = await provisionCommunityFromGuild(guild, invokerDiscordId);
    communityId = provisioned.communityId;
    if (provisioned.action === "ignored") return { action: "blocked", communityId };
    const bot = requireDiscord(await getSetupBot({ guildId, deadline }));
    const basePermissions = guild.roles.filter((r) => r.id === guildId || bot.roles.includes(r.id))
      .reduce((mask, r) => mask | BigInt(r.permissions), BigInt(0));
    const missing = missingSetupPermissions(basePermissions);
    if (missing.length) throw new SetupError(`Permissions manquantes pour le bot dans ce serveur : ${missing.join(", ")}. Corrige son rôle puis relance /gamenight setup.`);
    const channels = requireDiscord(await listSetupChannels({ guildId, deadline }));
    let configs = await prisma.communityChannelConfig.findMany({ where: { communityId } });
    const overwrites = [
      { id: guildId, type: 0, allow: MEMBER_CHANNEL_PERMISSIONS.toString(), deny: MEMBER_CHANNEL_DENY.toString() },
      { id: bot.id, type: 1, allow: BOT_CHANNEL_PERMISSIONS.toString(), deny: "0" },
    ];
    function validate(channel: SetupChannel, slot: string) {
      if (!(channel.type === 0 || (slot === "TOURNAMENT" && channel.type === 5)) || (channel.guild_id && channel.guild_id !== guildId)) {
        throw new SetupError(`Salon ${slot} incompatible ou étranger. Corrige la configuration existante ; setup ne la remplace pas.`);
      }
      const missing = missingSetupPermissions(channelPermissions(basePermissions, guildId, bot.id, bot.roles, channel.permission_overwrites));
      if (missing.length) throw new SetupError(`Permissions manquantes pour le bot dans #${channel.name} : ${missing.join(", ")}. Corrige ce salon puis relance setup.`);
    }
    if (existing?.slug === DEFAULT_COMMUNITY_SLUG && process.env.DISCORD_BOT_GUILD_ID?.trim() === guildId) {
      for (const [slot, key] of [["SESSION", "DISCORD_BOT_SESSION_CHANNEL_ID"], ["TOURNAMENT", "DISCORD_BOT_TOURNAMENT_CHANNEL_ID"]] as const) {
        const legacyId = process.env[key]?.trim();
        if (!legacyId || configs.some((c) => c.category === slot)) continue;
        const channel = channels.find((c) => c.id === legacyId);
        if (!channel) throw new SetupError(`Salon historique ${slot} introuvable dans ce serveur. Corrige la configuration avant de relancer setup.`);
        validate(channel, slot);
        await prisma.communityChannelConfig.createMany({ data: [{ communityId, category: slot, discordChannelId: legacyId }], skipDuplicates: true });
      }
      configs = await prisma.communityChannelConfig.findMany({ where: { communityId } });
    }
    // Validate all saved destinations before creating anything.
    for (const config of configs) {
      const channel = channels.find((c) => c.id === config.discordChannelId);
      if (!channel) throw new SetupError(`Salon ${config.category} enregistré introuvable dans ce serveur. Corrige sa configuration ; aucun remplacement automatique.`);
      validate(channel, config.category);
      if (!config.enabled) throw new SetupError(`Salon ${config.category} désactivé dans GameNight. Un admin doit le réactiver ; setup conserve ce choix.`);
    }
    let category: SetupChannel | undefined;
    if (configs.length < 2) {
      const categories = channels.filter((c) => c.type === 4 && c.name === "GameNight");
      if (categories.length > 1) throw new SetupError("Plusieurs catégories GameNight existent. Renomme les catégories en trop avant de relancer setup.");
      category = await discoverOrCreate(guildId, "CATEGORY", categories[0], { name: "GameNight", type: 4, permission_overwrites: overwrites }, deadline);
    }
    for (const [slot, name] of [["SESSION", "soirées"], ["TOURNAMENT", "tournois"]] as const) {
      if (configs.some((c) => c.category === slot)) continue;
      const topic = `GameNight:${guildId}:${slot}`;
      const candidates = channels.filter((c) => c.topic === topic);
      if (candidates.length > 1) throw new SetupError(`Plusieurs salons portent le marqueur ${slot}. Un admin doit les départager.`);
      const channel = await discoverOrCreate(guildId, slot, candidates[0], { name, type: 0, parent_id: category!.id, topic, permission_overwrites: overwrites }, deadline);
      validate(channel, slot);
      // Persist each destination separately; a concurrent admin config wins.
      await prisma.communityChannelConfig.createMany({ data: [{ communityId, category: slot, discordChannelId: channel.id }], skipDuplicates: true });
    }
    // Recheck destinations saved by an admin during setup before reporting success.
    const finalChannels = requireDiscord(await listSetupChannels({ guildId, deadline }));
    const finalConfigs = await prisma.communityChannelConfig.findMany({ where: { communityId } });
    for (const slot of ["SESSION", "TOURNAMENT"] as const) {
      const config = finalConfigs.find((c) => c.category === slot);
      const channel = finalChannels.find((c) => c.id === config?.discordChannelId);
      if (!config?.enabled || !channel) throw new SetupError(`Configuration ${slot} modifiée pendant setup. Vérifie les salons puis relance la commande.`);
      validate(channel, slot);
    }
    const activator = await prisma.user.findUnique({ where: { discordId: invokerDiscordId }, select: { id: true } });
    const { count } = await prisma.community.updateMany({
      where: { id: communityId, status: { in: ["PENDING", "LEFT"] } },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedById: activator?.id ?? null, leftAt: null },
    });
    const current = await prisma.community.findUnique({ where: { id: communityId }, select: { status: true } });
    return { action: current?.status !== "ACTIVE" ? "blocked" : count ? "activated" : "already_active", communityId };
  } catch (error) {
    if (error instanceof SetupError) return { action: "incomplete", communityId, message: error.message };
    throw error;
  } finally {
    await releaseCronLock(lock.token, lockName);
  }
}
