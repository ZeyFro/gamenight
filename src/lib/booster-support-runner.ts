import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import {
  addGuildMemberRole,
  createGuildRole,
  createSetupChannel,
  listGuildRoles,
  listSetupChannels,
  removeGuildMemberRole,
  type DiscordRestFailure,
  type DiscordRestResult,
} from "@/lib/discord-rest";
import { normalizeRoleKey, type GuildRoleSummary } from "@/lib/discord-guild-roles";
import {
  CHANNEL_TYPE_TEXT,
  CHANNEL_TYPE_VOICE,
  GUILD_CHANNEL_LIMIT,
  GUILD_ROLE_LIMIT,
  TEXT_CHANNEL_ALLOW,
  VIEW_CHANNEL,
  VOICE_CHANNEL_ALLOW,
} from "@/lib/discord-team-spaces";
import {
  BOOSTER_ROLE_COLOR,
  BOOSTER_ROLE_NAME,
  BOOSTER_TEXT_CHANNEL,
  BOOSTER_VOICE_CHANNEL,
  type BoosterIntent,
} from "@/lib/booster-support";

/**
 * Exécution PAR L'EXECUTOR (`performDiscordAction`, action `sync_booster_support`) : le seul chemin qui
 * écrit sur Discord pour les soutiens. Idempotent, aucune suppression de ressource.
 *
 * - `provision` : rôle « Soutien de la Tour » (SANS permission) et deux salons (écrit + vocal) invisibles
 *   de @everyone, visibles du rôle seulement. Les ressources sont retrouvées par nom ; un salon du même nom
 *   qui n'est PAS privé n'est jamais adopté (refus `unmanaged`, le staff décide).
 * - `member` : l'état courant en base décide — soutien actif = rôle ajouté ; fin de boost (ou départ de la
 *   communauté) = rôle retiré automatiquement.
 */
export interface BoosterActionInput {
  intent: BoosterIntent;
  communityId: string;
  discordId?: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
}

export interface BoosterDiscordApi {
  listRoles(guildId: string): Promise<DiscordRestResult<{ roles: GuildRoleSummary[] }>>;
  listChannels(guildId: string): Promise<DiscordRestResult<DiscordChannel[]>>;
  createRole(guildId: string): Promise<DiscordRestResult<{ id: string; name: string }>>;
  createChannel(guildId: string, name: string, type: 0 | 2, roleId: string): Promise<DiscordRestResult<{ id: string }>>;
  addRole(guildId: string, userId: string, roleId: string): Promise<DiscordRestResult<unknown>>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<DiscordRestResult<unknown>>;
}

export function createDiscordBoosterApi(deadline: Date): BoosterDiscordApi {
  return {
    listRoles: (guildId) => listGuildRoles({ guildId, deadline }),
    listChannels: (guildId) => listSetupChannels({ guildId, deadline }),
    createRole: (guildId) => createGuildRole({ guildId, name: BOOSTER_ROLE_NAME, color: BOOSTER_ROLE_COLOR, deadline }),
    createChannel: (guildId, name, type, roleId) =>
      createSetupChannel({
        guildId,
        deadline,
        channel: {
          name,
          type,
          permission_overwrites: [
            { id: guildId, type: 0, allow: "0", deny: VIEW_CHANNEL },
            { id: roleId, type: 0, allow: type === CHANNEL_TYPE_VOICE ? VOICE_CHANNEL_ALLOW : TEXT_CHANNEL_ALLOW, deny: "0" },
          ],
        },
      }),
    addRole: (guildId, userId, roleId) => addGuildMemberRole({ guildId, userId, roleId, deadline }),
    removeRole: (guildId, userId, roleId) => removeGuildMemberRole({ guildId, userId, roleId, deadline }),
  };
}

const retryable = (message: string): DiscordRestFailure => ({ ok: false, kind: "server_error", message, retryable: true });
const definitive = (message: string): DiscordRestFailure => ({ ok: false, kind: "invalid_request", message, retryable: false });
const done = { ok: true, data: {} } as const;

/** Un salon n'est adopté que s'il refuse déjà « Voir le salon » à @everyone. */
export function isPrivateToEveryone(channel: DiscordChannel, guildId: string): boolean {
  const overwrite = channel.permission_overwrites?.find((entry) => entry.id === guildId);
  return Boolean(overwrite && /^\d+$/.test(overwrite.deny) && (BigInt(overwrite.deny) & BigInt(VIEW_CHANNEL)) !== BigInt(0));
}

interface SpaceRow {
  guildId: string;
  roleId: string;
}

async function provision(
  input: { communityId: string; guildId: string },
  api: BoosterDiscordApi
): Promise<{ ok: true; space: SpaceRow } | DiscordRestFailure> {
  const scopedDb = scopedPrisma({ communityIds: [input.communityId], includesDefault: false });
  const existing = await scopedDb.boosterSupportSpace.findFirst({ where: { communityId: input.communityId }, select: { guildId: true, roleId: true } });
  if (existing) return { ok: true, space: existing };

  const roles = await api.listRoles(input.guildId);
  if (!roles.ok) return roles;
  const channels = await api.listChannels(input.guildId);
  if (!channels.ok) return channels;

  const wanted = normalizeRoleKey(BOOSTER_ROLE_NAME);
  const role = roles.data.roles.find((candidate) => !candidate.managed && normalizeRoleKey(candidate.name) === wanted);
  if (role && (BigInt(role.permissions || "0") !== BigInt(0))) return definitive("Un rôle « Soutien de la Tour » avec permissions existe : refus (unmanaged).");
  let roleId = role?.id;
  if (!roleId) {
    if (roles.data.roles.length >= GUILD_ROLE_LIMIT) return definitive("Limite de rôles Discord atteinte (capacity).");
    const created = await api.createRole(input.guildId);
    if (!created.ok) return created;
    roleId = created.data.id;
  }

  const find = (name: string, type: number) => channels.data.find((channel) => channel.type === type && channel.name === name);
  const textExisting = find(BOOSTER_TEXT_CHANNEL, CHANNEL_TYPE_TEXT);
  const voiceExisting = find(BOOSTER_VOICE_CHANNEL, CHANNEL_TYPE_VOICE);
  for (const channel of [textExisting, voiceExisting]) {
    if (channel && !isPrivateToEveryone(channel, input.guildId)) return definitive("Un salon du même nom est public : refus (unmanaged).");
  }
  const missing = [textExisting, voiceExisting].filter((channel) => !channel).length;
  if (channels.data.length + missing > GUILD_CHANNEL_LIMIT) return definitive("Limite de salons Discord atteinte (capacity).");
  let textId = textExisting?.id;
  let voiceId = voiceExisting?.id;
  if (!textId) {
    const created = await api.createChannel(input.guildId, BOOSTER_TEXT_CHANNEL, CHANNEL_TYPE_TEXT, roleId);
    if (!created.ok) return created;
    textId = created.data.id;
  }
  if (!voiceId) {
    const created = await api.createChannel(input.guildId, BOOSTER_VOICE_CHANNEL, CHANNEL_TYPE_VOICE, roleId);
    if (!created.ok) return created;
    voiceId = created.data.id;
  }
  await scopedDb.boosterSupportSpace.upsert({
    where: { communityId: input.communityId },
    update: {},
    create: { communityId: input.communityId, guildId: input.guildId, roleId, channelId: textId, voiceChannelId: voiceId },
  });
  return { ok: true, space: { guildId: input.guildId, roleId } };
}

export async function runBoosterSyncAction(
  input: BoosterActionInput,
  deadline: Date,
  api: BoosterDiscordApi = createDiscordBoosterApi(deadline),
  now: Date = new Date()
): Promise<DiscordRestResult<Record<string, never>>> {
  try {
    const community = await prisma.community.findUnique({ where: { id: input.communityId }, select: { status: true, discordGuildId: true } });
    if (community?.status !== "ACTIVE" || !community.discordGuildId) return definitive("Communauté inactive ou sans serveur Discord.");
    const guildId = community.discordGuildId;
    const scopedDb = scopedPrisma({ communityIds: [input.communityId], includesDefault: false });

    if (input.intent === "provision") {
      const result = await provision({ communityId: input.communityId, guildId }, api);
      return result.ok ? done : result;
    }
    if (!input.discordId) return definitive("Membre Discord manquant.");
    const row = await scopedDb.boosterSupport.findFirst({
      where: { communityId: input.communityId, discordId: input.discordId },
      select: { id: true, userId: true, boosting: true, roleGranted: true },
    });
    if (!row) return done;
    const active = await prisma.membership.count({ where: { communityId: input.communityId, userId: row.userId, status: "ACTIVE" } });
    const shouldHave = row.boosting && active > 0;

    let space: SpaceRow | null = await scopedDb.boosterSupportSpace.findFirst({ where: { communityId: input.communityId }, select: { guildId: true, roleId: true } });
    if (!space) {
      if (!shouldHave) {
        // Aucun rôle jamais créé : rien à retirer.
        await scopedDb.boosterSupport.updateMany({ where: { id: row.id, communityId: input.communityId }, data: { roleGranted: false } });
        return done;
      }
      const provisioned = await provision({ communityId: input.communityId, guildId }, api);
      if (!provisioned.ok) return provisioned;
      space = provisioned.space;
    }

    if (shouldHave) {
      const added = await api.addRole(guildId, input.discordId, space.roleId);
      if (!added.ok) return added.kind === "not_found" ? definitive("Membre introuvable sur le serveur.") : added;
    } else if (row.roleGranted) {
      const removed = await api.removeRole(guildId, input.discordId, space.roleId);
      // Rejouer un retrait (rôle déjà absent, membre parti) est un succès idempotent.
      if (!removed.ok && removed.kind !== "not_found") return removed;
    }
    await scopedDb.boosterSupport.updateMany({ where: { id: row.id, communityId: input.communityId }, data: { roleGranted: shouldHave, updatedAt: now } });
    return done;
  } catch (error) {
    logger.warn("booster-support", "Exécution Soutien impossible.", { intent: input.intent, errorType: error instanceof Error ? error.name : "unknown" });
    return retryable("Exécution Soutien impossible.");
  }
}
