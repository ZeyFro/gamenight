import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { communityMemberUserWhere } from "@/lib/community-isolation";
import { resolveSessionAnnounceConfig } from "@/lib/community-channels";
import { getDefaultCommunityId } from "@/lib/default-community";
import { logger } from "@/lib/logger";
import { formatDateTimeFr, wallClockNow } from "@/lib/wallclock";
import {
  sessionEndedAt,
  sessionSpaceDue,
  sessionVisibilityEnabled,
  type SessionVisibilityValue,
} from "@/lib/session-visibility";
import { selectSpaceMembers, sessionSpaceName } from "@/lib/session-space-plan";

/**
 * Espace Discord temporaire d'une soirée (flag `SESSION_VISIBILITY_ENABLED`) : un fil
 * PRIVÉ et un salon vocal PRIVÉ créés 30 min avant le début, supprimés une fois la soirée
 * terminée ET le vocal vide. Aucun appelant n'écrit directement sur Discord : l'executor
 * de notifications appelle ces fonctions (voir `session-space-queue.ts` / `-runner.ts`).
 *
 * Idempotent : chaque étape persiste son identifiant dans `SessionDiscordSpace` avant la
 * suivante ; un rejeu reprend là où il s'est arrêté, sans doublon. Une ressource déjà
 * absente côté Discord compte comme supprimée. Le vocal n'est jamais supprimé tant qu'un
 * participant s'y trouve (vérification REST par membre, sans gateway) ; en cas de doute
 * (lecture impossible), on ne supprime pas.
 */
export interface SessionSpaceApi {
  createPrivateThread(parentChannelId: string, name: string): Promise<string>;
  addThreadMember(threadId: string, discordUserId: string): Promise<void>;
  removeThreadMember(threadId: string, discordUserId: string): Promise<void>;
  createVoiceChannel(guildId: string, name: string, memberDiscordIds: string[]): Promise<string>;
  allowVoiceMember(channelId: string, discordUserId: string): Promise<void>;
  denyVoiceMember(channelId: string, discordUserId: string): Promise<void>;
  memberVoiceChannel(guildId: string, discordUserId: string): Promise<string | null>;
  deleteChannel(channelId: string): Promise<void>;
}

export interface SessionSpaceLink {
  sessionId: string;
  communityId: string;
  guildId: string;
  parentChannelId: string;
  threadId: string | null;
  voiceChannelId: string | null;
  cleanedAt: Date | null;
  accessRevokedAt: Date | null;
}

export interface SessionSpaceStore {
  find(sessionId: string): Promise<SessionSpaceLink | null>;
  save(link: Pick<SessionSpaceLink, "sessionId" | "communityId" | "guildId" | "parentChannelId"> & Partial<Pick<SessionSpaceLink, "threadId" | "voiceChannelId" | "cleanedAt" | "accessRevokedAt">>): Promise<void>;
}

export interface SessionSpaceSession {
  id: string;
  visibility: SessionVisibilityValue;
  status: string;
  date: Date;
  communityId: string;
  /** Destination configurée (serveur + salon parent des fils) ou `null`. */
  destination: { guildId: string; channelId: string } | null;
  /** Identifiants Discord des participants (créateur, coorganisateur, invités actifs / places confirmées), ordonnés. */
  roster: string[];
  /** Tout participant ayant pu recevoir un accès historique ; sert au retrait final. */
  cleanupRoster?: string[];
}

export interface SessionSpaceSource {
  load(sessionId: string): Promise<SessionSpaceSession | null>;
}

export type SessionSpaceStatus =
  | "created" | "reused" | "partial" | "updated" | "cleaned" | "occupied" | "nothing_to_do"
  | "disabled" | "not_found" | "not_due" | "not_ended" | "not_configured" | "too_small" | "failed";

export interface SessionSpaceResult {
  status: SessionSpaceStatus;
  threadId?: string;
  voiceChannelId?: string;
}

export function createPrismaSessionSpaceStore(): SessionSpaceStore {
  const scopedDb = scopedPrisma(null);
  return {
    async find(sessionId) {
      return scopedDb.sessionDiscordSpace.findUnique({
        where: { sessionId },
        select: { sessionId: true, communityId: true, guildId: true, parentChannelId: true, threadId: true, voiceChannelId: true, cleanedAt: true, accessRevokedAt: true },
      });
    },
    async save(link) {
      const { sessionId, communityId, guildId, parentChannelId, ...rest } = link;
      await scopedDb.sessionDiscordSpace.upsert({
        where: { sessionId },
        create: { sessionId, communityId, guildId, parentChannelId, ...rest },
        // On ne remplace jamais un identifiant déjà persisté : on complète seulement.
        update: Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && value !== null)),
      });
    },
  };
}

export function createPrismaSessionSpaceSource(): SessionSpaceSource {
  const scopedDb = scopedPrisma(null);
  return {
    async load(sessionId) {
      const session = await scopedDb.session.findUnique({
        where: { id: sessionId },
        select: {
          id: true, visibility: true, status: true, date: true, communityId: true, createdById: true, coOrganizerId: true, attendanceCapacity: true,
          invites: { orderBy: { createdAt: "asc" }, select: { userId: true, status: true } },
          seats: { where: { status: "CONFIRMED" }, select: { userId: true } },
        },
      });
      if (!session) return null;
      const communityId = session.communityId ?? (await getDefaultCommunityId());
      const confirmed = new Set(session.seats.map((seat) => seat.userId));
      const activeInvites = session.invites.filter((invite) => invite.status === "ACTIVE");
      const invited = activeInvites.map((invite) => invite.userId).filter((id) => session.attendanceCapacity === null || confirmed.has(id));
      const orderedIds = [...new Set([session.createdById, ...(session.coOrganizerId ? [session.coOrganizerId] : []), ...invited])];
      const cleanupIds = [...new Set([
        ...orderedIds,
        ...session.invites.map((invite) => invite.userId),
        ...session.seats.map((seat) => seat.userId),
      ])];
      // Seuls les membres encore actifs de la communauté de la soirée reçoivent un accès.
      const [users, cleanupUsers] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: orderedIds }, ...(await communityMemberUserWhere(session.communityId)) },
          select: { id: true, discordId: true },
        }),
        prisma.user.findMany({ where: { id: { in: cleanupIds } }, select: { id: true, discordId: true } }),
      ]);
      const discordById = new Map(users.map((user) => [user.id, user.discordId]));
      const cleanupDiscordById = new Map(cleanupUsers.map((user) => [user.id, user.discordId]));
      return {
        id: session.id,
        visibility: session.visibility,
        status: session.status,
        date: session.date,
        communityId,
        destination: await resolveSessionAnnounceConfig(session.communityId),
        roster: selectSpaceMembers(orderedIds.map((id) => discordById.get(id))),
        cleanupRoster: selectSpaceMembers(cleanupIds.map((id) => cleanupDiscordById.get(id))),
      };
    },
  };
}

function spaceNames(session: SessionSpaceSession) {
  const date = formatDateTimeFr(session.date);
  return { thread: sessionSpaceName("Soirée", date), voice: sessionSpaceName("🎲 Soirée", date) };
}

export async function provisionSessionSpace(input: {
  sessionId: string;
  api: SessionSpaceApi;
  store?: SessionSpaceStore;
  source?: SessionSpaceSource;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<SessionSpaceResult> {
  const env = input.env ?? process.env;
  if (!sessionVisibilityEnabled(env)) return { status: "disabled" };
  const store = input.store ?? createPrismaSessionSpaceStore();
  const source = input.source ?? createPrismaSessionSpaceSource();
  try {
    const session = await source.load(input.sessionId);
    if (!session) return { status: "not_found" };
    // Les soirées publiques utilisent les espaces communs. Les espaces Discord
    // temporaires et privés sont réservés aux modes sur candidature et privé.
    if (session.visibility === "PUBLIC") return { status: "nothing_to_do" };
    if (!sessionSpaceDue(session, input.now ?? wallClockNow())) return { status: "not_due" };
    if (!session.destination) return { status: "not_configured" };
    // Une soirée solo n'a pas besoin d'espace : ni fil ni vocal pour une seule personne.
    if (session.roster.length < 2) return { status: "too_small" };
    const existing = await store.find(session.id);
    if (existing?.cleanedAt) return { status: "nothing_to_do" };
    if (existing?.threadId && existing.voiceChannelId) {
      return { status: "reused", threadId: existing.threadId, voiceChannelId: existing.voiceChannelId };
    }
    const base = {
      sessionId: session.id,
      communityId: session.communityId,
      guildId: session.destination.guildId,
      parentChannelId: session.destination.channelId,
    };
    const names = spaceNames(session);
    let threadId = existing?.threadId ?? null;
    let voiceChannelId = existing?.voiceChannelId ?? null;
    if (!threadId) {
      threadId = await input.api.createPrivateThread(base.parentChannelId, names.thread);
      await store.save({ ...base, threadId });
    }
    for (const discordId of session.roster) await input.api.addThreadMember(threadId, discordId);
    if (!voiceChannelId) {
      voiceChannelId = await input.api.createVoiceChannel(base.guildId, names.voice, session.roster);
      await store.save({ ...base, voiceChannelId });
    }
    return { status: existing ? "reused" : "created", threadId, voiceChannelId };
  } catch (error) {
    logger.warn("session-space", "Création de l'espace de soirée impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
    return { status: "failed" };
  }
}

/** Ajout ou retrait d'un participant sur CET espace, d'après l'état courant (jamais l'état d'enqueue). */
export async function syncSessionSpaceMember(input: {
  sessionId: string;
  discordId: string;
  api: SessionSpaceApi;
  store?: SessionSpaceStore;
  source?: SessionSpaceSource;
  env?: Record<string, string | undefined>;
}): Promise<SessionSpaceResult> {
  const env = input.env ?? process.env;
  if (!sessionVisibilityEnabled(env)) return { status: "disabled" };
  const store = input.store ?? createPrismaSessionSpaceStore();
  const source = input.source ?? createPrismaSessionSpaceSource();
  try {
    const link = await store.find(input.sessionId);
    if (!link || link.cleanedAt) return { status: "nothing_to_do" };
    const session = await source.load(input.sessionId);
    if (!session) return { status: "not_found" };
    const allowed = session.roster.includes(input.discordId);
    if (allowed) {
      if (link.threadId) await input.api.addThreadMember(link.threadId, input.discordId);
      if (link.voiceChannelId) await input.api.allowVoiceMember(link.voiceChannelId, input.discordId);
    } else {
      if (link.threadId) await input.api.removeThreadMember(link.threadId, input.discordId);
      if (link.voiceChannelId) await input.api.denyVoiceMember(link.voiceChannelId, input.discordId);
    }
    return { status: "updated" };
  } catch (error) {
    logger.warn("session-space", "Synchronisation d'accès de soirée impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" };
  }
}

/**
 * Nettoyage après la fin : supprime le vocal puis le fil, SEULEMENT si le vocal est vide.
 * Participants vérifiés un par un ; une lecture impossible compte comme « peut-être occupé ».
 *
 * Une soirée passée en PUBLIC est nettoyée sans attendre la fin : son espace privé
 * ne doit plus exister. La coupure d'accès est marquée en base après succès pour
 * qu'une reprise (vocal occupé, erreur Discord) ne rejoue pas 2 appels par personne.
 */
export async function cleanupSessionSpace(input: {
  sessionId: string;
  api: SessionSpaceApi;
  store?: SessionSpaceStore;
  source?: SessionSpaceSource;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<SessionSpaceResult> {
  const env = input.env ?? process.env;
  if (!sessionVisibilityEnabled(env)) return { status: "disabled" };
  const store = input.store ?? createPrismaSessionSpaceStore();
  const source = input.source ?? createPrismaSessionSpaceSource();
  try {
    const link = await store.find(input.sessionId);
    if (!link || link.cleanedAt) return { status: "nothing_to_do" };
    const session = await source.load(input.sessionId);
    if (!session) return { status: "not_found" };
    const now = input.now ?? wallClockNow();
    // PUBLIC : l'espace privé doit disparaître même avant la date de fin.
    if (session.visibility !== "PUBLIC" && !sessionEndedAt(session, now)) return { status: "not_ended" };
    // Couper les accès avant d'attendre que le vocal soit vide ou de le supprimer.
    // Le marqueur n'est posé qu'après la boucle complète : une erreur au milieu
    // laisse la reprise refaire la coupure, sans jamais supprimer un accès encore actif.
    if (!link.accessRevokedAt) {
      for (const discordId of session.cleanupRoster ?? session.roster) {
        if (link.threadId) await input.api.removeThreadMember(link.threadId, discordId);
        if (link.voiceChannelId) await input.api.denyVoiceMember(link.voiceChannelId, discordId);
      }
      await store.save({
        sessionId: link.sessionId,
        communityId: link.communityId,
        guildId: link.guildId,
        parentChannelId: link.parentChannelId,
        accessRevokedAt: now,
      });
    }
    if (link.voiceChannelId) {
      for (const discordId of session.cleanupRoster ?? session.roster) {
        if ((await input.api.memberVoiceChannel(link.guildId, discordId)) === link.voiceChannelId) return { status: "occupied" };
      }
      await input.api.deleteChannel(link.voiceChannelId);
    }
    if (link.threadId) await input.api.deleteChannel(link.threadId);
    await store.save({ sessionId: link.sessionId, communityId: link.communityId, guildId: link.guildId, parentChannelId: link.parentChannelId, cleanedAt: new Date() });
    return { status: "cleaned" };
  } catch (error) {
    logger.warn("session-space", "Nettoyage de l'espace de soirée impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
    return { status: "failed" };
  }
}
