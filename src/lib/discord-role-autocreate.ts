import { z } from "zod";
import { logger } from "@/lib/logger";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import type { DeliveryResolver } from "@/lib/notification-executor";
import {
  addGuildMemberRole,
  createGuildRole,
  listGuildRoles,
  type DiscordRestFailure,
  type DiscordRestResult,
} from "@/lib/discord-rest";
import {
  DEFAULT_MAX_GUILD_ROLES,
  exactRoleMatches,
  isSensitiveRole,
  queryKey,
  type GuildRoleSummary,
} from "@/lib/discord-guild-roles";
import { CAPACITY_WARNING_RATIO, GUILD_ROLE_LIMIT } from "@/lib/discord-team-spaces";
import { syncGameRoleToProfile } from "@/lib/discord-role-sync";
import { withRoleCreationLock } from "@/lib/discord-role-lock";

/**
 * Création automatique d'un rôle de jeu par `/role` (DISCORD_ROLE_AUTOCREATE_ENABLED).
 *
 * AUCUNE écriture Discord directe : la commande enregistre une `DiscordRoleRequest`
 * (PENDING) et enfile un `NotificationEvent` ADMIN / `ROLE_AUTOCREATE` + une
 * `NotificationDelivery` BOT. L'executor réclame la livraison (bail), le résolveur
 * ci-dessous revérifie l'état, puis `runRoleCreationAction` crée le rôle (SANS
 * aucune permission, voir `createGuildRole`) et l'attribue au demandeur.
 *
 * Règles : 1 demande par joueur et par semaine (hors échecs) ; nom normalisé
 * unique par serveur ; plafond configurable de rôles (défaut 200, jamais au-delà
 * de la limite Discord de 250) ; alerte staff (événement `ROLE_CAPACITY_ALERT`,
 * lu par le tableau de bord /admin) dès 80 % des 250 rôles. Un rôle existant n'est
 * jamais dupliqué, un rôle sensible n'est jamais attribué.
 */
export const ROLE_AUTOCREATE_EVENT = "ROLE_AUTOCREATE";
export const ROLE_CAPACITY_ALERT_EVENT = "ROLE_CAPACITY_ALERT";
export const ROLE_REQUEST_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Une demande PENDING plus ancienne est considérée abandonnée : elle ne bloque ni le quota ni le nom. */
export const ROLE_REQUEST_STALE_MS = 2 * 60 * 60_000;
/** 80 % de la limite Discord de 250 rôles. */
export const ROLE_ALERT_THRESHOLD = Math.ceil(GUILD_ROLE_LIMIT * CAPACITY_WARNING_RATIO);

export function roleAutocreateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_ROLE_AUTOCREATE_ENABLED === "true";
}

export function roleAutocreateQueueReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return roleAutocreateEnabled(env) && env.NOTIFICATION_EXECUTOR_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

/** Plafond de rôles du serveur (configurable), jamais au-delà de la limite Discord. */
export function roleCreationCap(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.DISCORD_ROLE_MAX_GUILD_ROLES);
  if (!Number.isInteger(configured) || configured <= 0) return DEFAULT_MAX_GUILD_ROLES;
  return Math.min(configured, GUILD_ROLE_LIMIT);
}

export type RoleCapacity = "ok" | "alert" | "full";

/** `count` = rôles existants + demandes en cours. Fonction pure. */
export function roleCapacity(count: number, cap: number): RoleCapacity {
  if (count >= cap) return "full";
  return count >= ROLE_ALERT_THRESHOLD ? "alert" : "ok";
}

export interface RoleRequestRow {
  id: string;
  requesterDiscordId: string;
  status: "PENDING" | "CREATED" | "FAILED";
  requestedAt: Date;
}

export interface RoleRequestStore {
  findByName(guildId: string, nameKey: string): Promise<RoleRequestRow | null>;
  /** Demandes du joueur qui comptent pour son quota (CREATED, ou PENDING non périmée). */
  countActiveSince(discordId: string, since: Date, staleBefore: Date): Promise<{ count: number; oldest: Date | null }>;
  countPending(guildId: string, staleBefore: Date): Promise<number>;
  upsertPending(input: {
    communityId: string;
    guildId: string;
    nameKey: string;
    name: string;
    requesterDiscordId: string;
    now: Date;
  }): Promise<{ id: string }>;
  markFailed(id: string, reason: string, now: Date): Promise<void>;
}

export function createPrismaRoleRequestStore(communityId: string): RoleRequestStore {
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const active = (since: Date, staleBefore: Date) => ({
    requestedAt: { gte: since },
    OR: [{ status: "CREATED" as const }, { status: "PENDING" as const, requestedAt: { gt: staleBefore } }],
  });
  return {
    findByName: (guildId, nameKey) =>
      scopedDb.discordRoleRequest.findUnique({
        where: { guildId_nameKey: { guildId, nameKey } },
        select: { id: true, requesterDiscordId: true, status: true, requestedAt: true },
      }),
    async countActiveSince(discordId, since, staleBefore) {
      const where = { requesterDiscordId: discordId, ...active(since, staleBefore) };
      const [count, oldest] = await Promise.all([
        scopedDb.discordRoleRequest.count({ where }),
        scopedDb.discordRoleRequest.findFirst({ where, orderBy: { requestedAt: "asc" }, select: { requestedAt: true } }),
      ]);
      return { count, oldest: oldest?.requestedAt ?? null };
    },
    countPending: (guildId, staleBefore) =>
      scopedDb.discordRoleRequest.count({ where: { guildId, status: "PENDING", requestedAt: { gt: staleBefore } } }),
    async upsertPending(input) {
      const data = {
        name: input.name,
        requesterDiscordId: input.requesterDiscordId,
        status: "PENDING" as const,
        roleId: null,
        failureReason: null,
        completedAt: null,
        requestedAt: input.now,
      };
      return scopedDb.discordRoleRequest.upsert({
        where: { guildId_nameKey: { guildId: input.guildId, nameKey: input.nameKey } },
        update: data,
        create: { ...data, communityId: input.communityId, guildId: input.guildId, nameKey: input.nameKey },
        select: { id: true },
      });
    },
    async markFailed(id, reason, now) {
      await scopedDb.discordRoleRequest.updateMany({
        where: { id, communityId },
        data: { status: "FAILED", failureReason: reason, completedAt: now },
      });
    },
  };
}

export type RoleRequestResult =
  | { status: "queued"; requestId: string }
  | { status: "already_pending" }
  | { status: "quota"; nextAt: Date }
  | { status: "guild_full" }
  | { status: "busy" }
  | { status: "unavailable" };

export interface RoleRequestInput {
  communityId: string;
  guildId: string;
  discordId: string;
  name: string;
  /** Nombre de rôles actuellement présents sur le serveur (lu juste avant par la commande). */
  roleCount: number;
  now?: Date;
  store?: RoleRequestStore;
  enqueue?: typeof enqueueRoleCreation;
  alert?: typeof recordRoleCapacityAlert;
}

const isMissingTable = (error: unknown) => {
  const code = (error as { code?: string }).code;
  return code === "P2021" || code === "P2022" || (error as Error)?.message?.includes("does not exist") === true;
};

/**
 * Enregistre une demande et l'enfile. Sérialisée par joueur (verrou CronLock) :
 * deux clics simultanés ne dépassent jamais le quota hebdomadaire.
 */
export async function requestRoleCreation(input: RoleRequestInput): Promise<RoleRequestResult> {
  if (!roleAutocreateQueueReady()) return { status: "unavailable" };
  const nameKey = queryKey(input.name);
  if (!nameKey) return { status: "unavailable" };
  const now = input.now ?? new Date();
  const store = input.store ?? createPrismaRoleRequestStore(input.communityId);
  const enqueue = input.enqueue ?? enqueueRoleCreation;
  const alert = input.alert ?? recordRoleCapacityAlert;
  try {
    const locked = await withRoleCreationLock({
      guildId: input.guildId,
      key: `request:${input.discordId}`,
      run: async (): Promise<RoleRequestResult> => {
        const staleBefore = new Date(now.getTime() - ROLE_REQUEST_STALE_MS);
        const existing = await store.findByName(input.guildId, nameKey);
        if (existing?.status === "PENDING" && existing.requestedAt > staleBefore) return { status: "already_pending" };

        const quota = await store.countActiveSince(input.discordId, new Date(now.getTime() - ROLE_REQUEST_WINDOW_MS), staleBefore);
        if (quota.count >= 1) {
          return { status: "quota", nextAt: new Date((quota.oldest ?? now).getTime() + ROLE_REQUEST_WINDOW_MS) };
        }

        const pending = await store.countPending(input.guildId, staleBefore);
        const capacity = roleCapacity(input.roleCount + pending, roleCreationCap());
        if (capacity !== "ok") {
          await alert({ communityId: input.communityId, guildId: input.guildId, roleCount: input.roleCount + pending, now });
        }
        if (capacity === "full") return { status: "guild_full" };

        const row = await store.upsertPending({
          communityId: input.communityId,
          guildId: input.guildId,
          nameKey,
          name: input.name,
          requesterDiscordId: input.discordId,
          now,
        });
        const queued = await enqueue({ requestId: row.id, communityId: input.communityId, guildId: input.guildId, requestedAt: now });
        if (!queued) {
          await store.markFailed(row.id, "enqueue_failed", now);
          return { status: "unavailable" };
        }
        return { status: "queued", requestId: row.id };
      },
    });
    return locked.status === "busy" ? { status: "busy" } : locked.value;
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    logger.warn("discord-role-autocreate", "Table des demandes de rôle absente : migration requise.");
    return { status: "unavailable" };
  }
}

const slotFor = (guildId: string, requestId: string) => `${guildId}:ADMIN:${requestId}:role-create`;

/** Événement + livraison ; `false` si l'enfilage échoue (journalisé, jamais silencieux). */
export async function enqueueRoleCreation(input: {
  requestId: string;
  communityId: string;
  guildId: string;
  requestedAt: Date;
}): Promise<boolean> {
  try {
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: ROLE_AUTOCREATE_EVENT,
      sourceId: input.requestId,
      occurrence: String(input.requestedAt.getTime()),
      payload: { requestId: input.requestId },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `role-request:${input.requestId}`,
      targetSlot: slotFor(input.guildId, input.requestId),
    });
    return true;
  } catch (error) {
    logger.warn("discord-role-autocreate", "Demande de rôle non enfilée.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

/**
 * Alerte staff : un `NotificationEvent` ADMIN sans livraison (aucun message Discord),
 * dédupliqué par jour, lu par le tableau de bord staff. Journalisé en `error`.
 */
export async function recordRoleCapacityAlert(input: {
  communityId: string;
  guildId: string;
  roleCount: number;
  now?: Date;
}): Promise<void> {
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  logger.error("discord-role-autocreate", "Seuil de rôles Discord atteint (80 % de 250).", {
    guildId: input.guildId,
    roleCount: input.roleCount,
    limit: GUILD_ROLE_LIMIT,
  });
  try {
    await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: ROLE_CAPACITY_ALERT_EVENT,
      sourceId: input.guildId,
      occurrence: day,
      payload: { roleCount: input.roleCount, limit: GUILD_ROLE_LIMIT },
    });
  } catch (error) {
    logger.warn("discord-role-autocreate", "Alerte de capacité des rôles non enregistrée.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
}

const payloadSchema = z.object({ requestId: z.string().min(1) });

export const roleCreationResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== ROLE_AUTOCREATE_EVENT || !event.communityId) {
      return { eligible: false, reason: "unresolvable" };
    }
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success || payload.data.requestId !== event.sourceId) return { eligible: false, reason: "unresolvable" };
    if (!roleAutocreateEnabled()) return { eligible: false, reason: "not_configured" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const community = await prisma.community.findUnique({
      where: { id: event.communityId },
      select: { status: true, discordGuildId: true },
    });
    if (community?.status !== "ACTIVE" || !community.discordGuildId) return { eligible: false, reason: "expired" };
    if (
      delivery.operation !== "SEND" ||
      delivery.channel !== "DISCORD_CHANNEL" ||
      delivery.transport !== "BOT" ||
      delivery.recipientKey !== `role-request:${event.sourceId}` ||
      delivery.targetSlot !== slotFor(community.discordGuildId, event.sourceId)
    ) {
      return { eligible: false, reason: "unresolvable" };
    }
    const scopedDb = scopedPrisma({ communityIds: [event.communityId], includesDefault: false });
    const row = await scopedDb.discordRoleRequest.findFirst({
      where: { id: event.sourceId, communityId: event.communityId },
      select: { status: true },
    });
    // Déjà traitée (CREATED/FAILED) ou supprimée : rien à faire, pas de nouvel appel Discord.
    if (row?.status !== "PENDING") return { eligible: false, reason: "expired" };
    return { eligible: true, action: { kind: "create_game_role", requestId: event.sourceId, communityId: event.communityId } };
  },
};

export interface RoleCreationApi {
  listRoles(guildId: string): Promise<DiscordRestResult<{ roles: GuildRoleSummary[] }>>;
  createRole(guildId: string, name: string): Promise<DiscordRestResult<{ id: string; name: string }>>;
  addMemberRole(guildId: string, userId: string, roleId: string): Promise<DiscordRestResult<{ added: true }>>;
}

export function createDiscordRoleCreationApi(deadline: Date): RoleCreationApi {
  return {
    listRoles: (guildId) => listGuildRoles({ guildId, deadline }),
    createRole: (guildId, name) => createGuildRole({ guildId, name, deadline }),
    addMemberRole: (guildId, userId, roleId) => addGuildMemberRole({ guildId, userId, roleId, deadline }),
  };
}

const retryable = (message: string): DiscordRestFailure => ({ ok: false, kind: "server_error", message, retryable: true });
const definitive = (message: string): DiscordRestFailure => ({ ok: false, kind: "invalid_request", message, retryable: false });
const done = { ok: true, data: {} } as const;

/**
 * Exécution PAR L'EXECUTOR (`performDiscordAction`, action `create_game_role`).
 * Idempotent : un rejeu retrouve le rôle par son nom normalisé (jamais de doublon) et
 * l'attribution est un PUT. Un échec définitif marque la demande FAILED (quota libéré).
 */
export async function runRoleCreationAction(
  input: { requestId: string; communityId: string },
  deadline: Date,
  api: RoleCreationApi = createDiscordRoleCreationApi(deadline),
  now: Date = new Date()
): Promise<DiscordRestResult<Record<string, never>>> {
  const scopedDb = scopedPrisma({ communityIds: [input.communityId], includesDefault: false });
  const fail = async (reason: string, message: string) => {
    await scopedDb.discordRoleRequest.updateMany({
      where: { id: input.requestId, communityId: input.communityId },
      data: { status: "FAILED", failureReason: reason, completedAt: now },
    });
    return definitive(message);
  };
  try {
    const request = await scopedDb.discordRoleRequest.findFirst({
      where: { id: input.requestId, communityId: input.communityId },
      select: { id: true, guildId: true, name: true, requesterDiscordId: true, status: true, roleId: true },
    });
    if (!request) return definitive("Demande de rôle introuvable.");
    if (request.status === "FAILED") return done;

    let roleId = request.roleId;
    if (!roleId) {
      const listed = await api.listRoles(request.guildId);
      if (!listed.ok) return listed;
      const roles = listed.data.roles;
      const existing = exactRoleMatches(roles, request.name);
      if (existing.length > 0) {
        if (isSensitiveRole(existing[0])) return fail("sensitive", "Rôle existant sensible : jamais attribué.");
        roleId = existing[0].id;
      } else {
        if (roleCapacity(roles.length, roleCreationCap()) === "full") {
          await recordRoleCapacityAlert({ communityId: input.communityId, guildId: request.guildId, roleCount: roles.length, now });
          return fail("guild_full", "Plafond de rôles du serveur atteint.");
        }
        const created = await api.createRole(request.guildId, request.name);
        if (!created.ok) return created;
        roleId = created.data.id;
        // Persisté tout de suite : un rejeu ne recrée jamais le rôle.
        await scopedDb.discordRoleRequest.updateMany({ where: { id: request.id, communityId: input.communityId }, data: { roleId } });
        if (roleCapacity(roles.length + 1, roleCreationCap()) !== "ok") {
          await recordRoleCapacityAlert({ communityId: input.communityId, guildId: request.guildId, roleCount: roles.length + 1, now });
        }
      }
    }

    const added = await api.addMemberRole(request.guildId, request.requesterDiscordId, roleId);
    if (!added.ok && added.kind !== "not_found") return added;
    await scopedDb.discordRoleRequest.updateMany({
      where: { id: request.id, communityId: input.communityId },
      data: { status: "CREATED", roleId, completedAt: now, failureReason: added.ok ? null : "member_not_found" },
    });
    if (added.ok) await syncGameRoleToProfile({ discordId: request.requesterDiscordId, gameName: request.name });
    return done;
  } catch (error) {
    logger.warn("discord-role-autocreate", "Création de rôle impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return retryable("Création de rôle impossible.");
  }
}
