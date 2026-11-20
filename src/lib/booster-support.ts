import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { getGuildMemberProfile } from "@/lib/discord-rest";
import type { DeliveryResolver } from "@/lib/notification-executor";

/**
 * Soutiens Nitro (DISCORD_BOOSTERS_ENABLED) — STRICTEMENT COSMÉTIQUE.
 *
 * Un cron REST (`/api/cron/booster-sync`, sans gateway) lit `premium_since` de chaque membre actif de
 * GameNight (`GET /guilds/{id}/members/{id}`, par lots rotatifs) et tient `BoosterSupport` à jour. Chaque
 * changement d'état est enfilé (événement ADMIN BOOSTER_SUPPORT_SYNC, executor, jamais d'appel direct) :
 * attribution ou retrait AUTOMATIQUE du rôle « Soutien de la Tour » (sans aucune permission) et, une fois,
 * création du rôle et des deux salons réservés (écrit + vocal). Badge/halo du profil et « Mur des soutiens »
 * (/soutiens) lisent cette table.
 *
 * Interdits tenus : aucun avantage de jeu (ni XP, ni étages, ni vote, ni classement), aucune permission
 * Discord, aucune suppression de ressource Discord.
 */
export const BOOSTER_SYNC_EVENT = "BOOSTER_SUPPORT_SYNC";
export const BOOSTER_ROLE_NAME = "Soutien de la Tour";
export const BOOSTER_ROLE_COLOR = 0xb99aff;
export const BOOSTER_TEXT_CHANNEL = "soutiens-de-la-tour";
export const BOOSTER_VOICE_CHANNEL = "Soutiens de la Tour";
export const BOOSTER_BATCH_SIZE = 100;
export const BOOSTER_SYNC_BUDGET_MS = 40_000;
const BUCKET_MS = 10 * 60_000;
const snowflake = /^[0-9]{16,20}$/;

export type BoosterIntent = "provision" | "member";

export const boostersEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.DISCORD_BOOSTERS_ENABLED === "true";

/** Écritures Discord : flag + executor + jeton du bot (la lecture REST du cron n'exige que flag + jeton). */
export function boosterQueueReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return boostersEnabled(env) && env.NOTIFICATION_EXECUTOR_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

export type BoosterTransition = "start" | "end" | "unchanged";

/** Fonction pure : que faire de la dernière observation Discord ? */
export function boosterTransition(previouslyBoosting: boolean, premiumSince: string | null): BoosterTransition {
  const now = premiumSince !== null && Number.isFinite(Date.parse(premiumSince));
  if (now && !previouslyBoosting) return "start";
  if (!now && previouslyBoosting) return "end";
  return "unchanged";
}

/** Un état « à synchroniser » : le rôle ne correspond pas encore à ce que Discord dit. */
export const needsRoleSync = (row: { boosting: boolean; roleGranted: boolean }): boolean => row.boosting !== row.roleGranted;

const slotFor = (guildId: string, communityId: string, intent: BoosterIntent, discordId?: string) =>
  `${guildId}:ADMIN:${communityId}:booster-${intent}${intent === "member" ? `-${discordId}` : ""}`;

/** Idempotent par fenêtre de 10 minutes (même communauté, intention et membre). */
export async function enqueueBoosterSync(
  input: { communityId: string; guildId: string; intent: BoosterIntent; discordId?: string },
  now: Date = new Date()
): Promise<boolean> {
  if (!boosterQueueReady()) return false;
  if (input.intent === "member" && !snowflake.test(input.discordId ?? "")) return false;
  try {
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: BOOSTER_SYNC_EVENT,
      sourceId: input.communityId,
      occurrence: `${input.intent}:${input.discordId ?? "-"}:${Math.floor(now.getTime() / BUCKET_MS)}`,
      payload: { intent: input.intent, ...(input.discordId ? { discordId: input.discordId } : {}) },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `booster:${input.communityId}`,
      targetSlot: slotFor(input.guildId, input.communityId, input.intent, input.discordId),
    });
    return true;
  } catch (error) {
    logger.warn("booster-support", "Synchronisation Soutien non enfilée.", { errorType: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}

const payloadSchema = z.object({
  intent: z.enum(["provision", "member"]),
  discordId: z.string().regex(snowflake).optional(),
});

export const boosterSyncResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== BOOSTER_SYNC_EVENT || !event.communityId || event.sourceId !== event.communityId) {
      return { eligible: false, reason: "unresolvable" };
    }
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    if (!boostersEnabled()) return { eligible: false, reason: "not_configured" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const community = await prisma.community.findUnique({ where: { id: event.communityId }, select: { status: true, discordGuildId: true } });
    if (community?.status !== "ACTIVE" || !community.discordGuildId) return { eligible: false, reason: "expired" };
    const { intent, discordId } = payload.data;
    if (
      delivery.operation !== "SEND" ||
      delivery.channel !== "DISCORD_CHANNEL" ||
      delivery.transport !== "BOT" ||
      delivery.recipientKey !== `booster:${event.communityId}` ||
      delivery.targetSlot !== slotFor(community.discordGuildId, event.communityId, intent, discordId)
    ) {
      return { eligible: false, reason: "unresolvable" };
    }
    return { eligible: true, action: { kind: "sync_booster_support", intent, communityId: event.communityId, discordId } };
  },
};

export interface BoosterSyncDeps {
  readProfile?: (guildId: string, discordId: string, deadline: Date) => Promise<
    { ok: true; premiumSince: string | null } | { ok: false; kind: string }
  >;
  enqueue?: typeof enqueueBoosterSync;
  now?: () => Date;
}

export interface BoosterSyncSummary {
  communities: number;
  checked: number;
  started: number;
  ended: number;
  queued: number;
  errors: number;
  stoppedEarly: boolean;
}

async function defaultReadProfile(guildId: string, discordId: string, deadline: Date) {
  const result = await getGuildMemberProfile({ guildId, userId: discordId, deadline });
  if (result.ok) return { ok: true as const, premiumSince: result.data.premiumSince };
  return { ok: false as const, kind: result.kind };
}

/**
 * Passage du cron : lot rotatif (les membres les moins récemment vérifiés d'abord). Un membre parti du
 * serveur (404) n'booste plus. Toute autre erreur laisse l'état inchangé (jamais de retrait sur doute) ;
 * la limite de débit arrête le passage.
 */
export async function runBoosterSync(deps: BoosterSyncDeps = {}): Promise<BoosterSyncSummary> {
  const summary: BoosterSyncSummary = { communities: 0, checked: 0, started: 0, ended: 0, queued: 0, errors: 0, stoppedEarly: false };
  if (!boostersEnabled() || !process.env.DISCORD_BOT_TOKEN?.trim()) return summary;
  const now = deps.now ?? (() => new Date());
  const read = deps.readProfile ?? defaultReadProfile;
  const enqueue = deps.enqueue ?? enqueueBoosterSync;
  const startedAt = Date.now();
  const communities = await prisma.community.findMany({
    where: { status: "ACTIVE", discordGuildId: { not: null } },
    select: { id: true, discordGuildId: true },
  });

  for (const community of communities) {
    const guildId = community.discordGuildId;
    if (!guildId) continue;
    summary.communities += 1;
    const scopedDb = scopedPrisma({ communityIds: [community.id], includesDefault: false });
    const [members, rows, space] = await Promise.all([
      prisma.membership.findMany({
        where: { communityId: community.id, status: "ACTIVE" },
        select: { userId: true, user: { select: { discordId: true } } },
      }),
      scopedDb.boosterSupport.findMany({ where: { communityId: community.id } }),
      scopedDb.boosterSupportSpace.findFirst({ where: { communityId: community.id }, select: { id: true } }),
    ]);
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    const activeIds = new Set(members.map((member) => member.userId));

    // Membres devenus inactifs alors qu'ils boostaient : fin de soutien, retrait du rôle.
    for (const row of rows.filter((candidate) => candidate.boosting && !activeIds.has(candidate.userId))) {
      await scopedDb.boosterSupport.updateMany({ where: { id: row.id, communityId: community.id }, data: { boosting: false, endedAt: now() } });
      summary.ended += 1;
      if (await enqueue({ communityId: community.id, guildId, intent: "member", discordId: row.discordId }, now())) summary.queued += 1;
    }

    const batch = members
      .filter((member) => snowflake.test(member.user.discordId))
      .sort((a, b) => (byUser.get(a.userId)?.checkedAt.getTime() ?? 0) - (byUser.get(b.userId)?.checkedAt.getTime() ?? 0))
      .slice(0, BOOSTER_BATCH_SIZE);

    let anyBooster = rows.some((row) => row.boosting);
    for (const member of batch) {
      if (Date.now() - startedAt > BOOSTER_SYNC_BUDGET_MS) {
        summary.stoppedEarly = true;
        break;
      }
      const discordId = member.user.discordId;
      const result = await read(guildId, discordId, new Date(Date.now() + 5_000));
      let premiumSince: string | null = null;
      if (!result.ok) {
        if (result.kind === "rate_limited") {
          summary.errors += 1;
          summary.stoppedEarly = true;
          break;
        }
        if (result.kind !== "not_found") {
          summary.errors += 1;
          continue;
        }
      } else {
        premiumSince = result.premiumSince;
      }
      summary.checked += 1;
      const previous = byUser.get(member.userId);
      const transition = boosterTransition(previous?.boosting ?? false, premiumSince);
      const boosting = premiumSince !== null && Number.isFinite(Date.parse(premiumSince));
      const checkedAt = now();
      await scopedDb.boosterSupport.upsert({
        where: { communityId_userId: { communityId: community.id, userId: member.userId } },
        update: {
          boosting,
          discordId,
          checkedAt,
          ...(boosting ? { since: new Date(premiumSince as string), endedAt: null } : transition === "end" ? { endedAt: checkedAt } : {}),
        },
        create: {
          communityId: community.id,
          userId: member.userId,
          discordId,
          boosting,
          since: boosting ? new Date(premiumSince as string) : null,
          checkedAt,
        },
      });
      if (transition === "start") summary.started += 1;
      if (transition === "end") summary.ended += 1;
      anyBooster = anyBooster || boosting;
      if (transition !== "unchanged" || needsRoleSync({ boosting, roleGranted: previous?.roleGranted ?? false })) {
        if (await enqueue({ communityId: community.id, guildId, intent: "member", discordId }, now())) summary.queued += 1;
      }
    }
    // Premier soutien : rôle et salons créés une seule fois (retrouvés par nom ensuite).
    if (anyBooster && !space && (await enqueue({ communityId: community.id, guildId, intent: "provision" }, now()))) summary.queued += 1;
    if (summary.stoppedEarly) break;
  }
  return summary;
}

export interface SupportWallEntry {
  userId: string;
  name: string;
  image: string | null;
  since: Date | null;
}

/**
 * Mur des soutiens : membres actifs qui boostent. Les profils masqués (UserProfileVisibility HIDDEN)
 * n'apparaissent jamais. Aucune donnée de paiement, aucun classement.
 */
export async function loadSupportWall(communityId: string): Promise<SupportWallEntry[]> {
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const rows = await scopedDb.boosterSupport.findMany({
    where: {
      communityId,
      boosting: true,
      user: { profileVisibility: { is: null }, memberships: { some: { communityId, status: "ACTIVE" } } },
    },
    orderBy: [{ since: "asc" }, { userId: "asc" }],
    select: { userId: true, since: true, user: { select: { discordName: true, discordAvatar: true } } },
  });
  return rows.map((row) => ({ userId: row.userId, name: row.user.discordName, image: row.user.discordAvatar ?? null, since: row.since }));
}

/**
 * État stocké d'un membre pour le profil (aucun appel Discord). `null` si la fonction est fermée ou
 * si la table est absente : l'appelant retombe alors sur son comportement habituel.
 */
export async function readStoredBoosterState(input: { userId: string; communityId: string }): Promise<{ boosting: boolean; since: Date | null } | null> {
  if (!boostersEnabled()) return null;
  try {
    const scopedDb = scopedPrisma({ communityIds: [input.communityId], includesDefault: false });
    const row = await scopedDb.boosterSupport.findFirst({
      where: { communityId: input.communityId, userId: input.userId },
      select: { boosting: true, since: true },
    });
    return row ?? null;
  } catch (error) {
    logger.warn("booster-support", "État Soutien indisponible.", { errorType: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}
