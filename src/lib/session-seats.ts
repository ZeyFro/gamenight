import { prisma } from "@/lib/prisma";
import { scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getIsolationScope, communityMemberUserWhere } from "@/lib/community-isolation";
import { accessibleSessionWhere } from "@/lib/session-access";
import { lockCreationMembers } from "@/lib/creation-intent";
import { enqueueSessionAnnounceUpdate } from "@/lib/session-announce";
import { wallClockNow } from "@/lib/wallclock";
import { planSessionSeats, type SeatStatus } from "@/lib/session-seat-plan";

export type SeatCommand = { kind: "join" | "leave" | "refresh" } | { kind: "capacity"; capacity: number };
export type SeatResult = { ok: true; status?: SeatStatus; replayed?: boolean } | { ok: false; error: "access" | "closed" | "disabled" | "capacity" };

/** Origine signée par Discord, jamais fournie par une action du navigateur. */
export interface DiscordSeatOrigin {
  interactionId: string;
  discordId: string;
  guildId?: string;
  channelId: string;
  messageId: string;
}

export async function readSessionSeats(userId: string, sessionId: string) {
  const scope = await getIsolationScope(userId);
  const scopedDb = scopedPrisma(scope);
  const session = await scopedDb.session.findFirst({
    where: { id: sessionId, ...accessibleSessionWhere(userId, scope) },
    select: { attendanceCapacity: true, communityId: true, createdById: true, invites: { where: { status: "ACTIVE" }, select: { userId: true } } },
  });
  if (!session) return null;
  const seats = await scopedDb.sessionSeat.findMany({
    where: { sessionId, userId: { in: [session.createdById, ...session.invites.map(invite => invite.userId)] }, user: await communityMemberUserWhere(session.communityId) },
    orderBy: [{ requestedAt: "asc" }, { userId: "asc" }], select: { userId: true, status: true, user: { select: { discordName: true } } },
  });
  return { attendanceCapacity: session.attendanceCapacity, seats };
}

/** L'accès privé et la communauté sont relus dans la transaction ; le verrou
 * de Session sérialise capacité, désistement et admission de la dernière place.
 * SessionSeat hérite de ce parent validé, aucune requête par id de siège reçu. */
export async function changeSessionSeat(userId: string, sessionId: string, command: SeatCommand, origin?: DiscordSeatOrigin): Promise<SeatResult> {
  const scope = await getIsolationScope(userId);
  return prisma.$transaction(async tx => {
    const scopedDb = scopedTransactionPrisma(tx, scope);
    const where = { id: sessionId, ...accessibleSessionWhere(userId, scope) };
    if (!await scopedDb.session.findFirst({ where, select: { id: true } })) return { ok: false, error: "access" };
    await scopedDb.$queryRaw`SELECT id FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
    const session = await scopedDb.session.findFirst({ where, include: { decidedGame: { select: { maxPlayers: true } } } });
    if (!session) return { ok: false, error: "access" };
    let receiptWhere;
    if (origin) {
      if (command.kind !== "join" && command.kind !== "leave") return { ok: false, error: "access" };
      const communityId = session.communityId ?? (await scopedDb.community.findUnique({ where: { slug: "default" }, select: { id: true } }))?.id;
      if (!communityId) return { ok: false, error: "access" };
      // Ces contrôles s'appliquent même flags OFF. Aucune préférence de serveur
      // active n'autorise une réponse ; seul le parent et ses membres comptent.
      const [community] = await scopedDb.$queryRaw<Array<{ status: string; slug: string; discordGuildId: string | null }>>`SELECT status, slug, "discordGuildId" FROM "Community" WHERE id = ${communityId} FOR SHARE`;
      const [member] = await scopedDb.$queryRaw<Array<{ status: string }>>`SELECT status FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR SHARE`;
      const actor = await scopedDb.user.findUnique({ where: { id: userId }, select: { discordId: true } });
      if (community?.status !== "ACTIVE" || member?.status !== "ACTIVE" || actor?.discordId !== origin.discordId || (origin.guildId !== undefined && community.discordGuildId !== origin.guildId)) return { ok: false, error: "access" };
      const delivered = await scopedDb.notificationDelivery.findFirst({ where: {
        status: "SENT", operation: "SEND", transport: "BOT", discordMessageId: origin.messageId,
        event: { category: "SESSION", sourceId: sessionId, OR: community.slug === "default" ? [{ communityId }, { communityId: null }] : [{ communityId }] },
        ...(origin.guildId ? { channel: "DISCORD_CHANNEL", discordThreadId: origin.channelId }
          : { channel: "DISCORD_DM", discordChannelId: origin.channelId, recipientKey: `user:${userId}` }),
      }, select: { id: true } });
      if (!delivered) return { ok: false, error: "access" };
      receiptWhere = { category_eventType_sourceId_occurrence: { category: "SESSION" as const, eventType: "SESSION_RSVP", sourceId: sessionId, occurrence: origin.interactionId } };
      const receipt = await scopedDb.notificationEvent.findUnique({ where: receiptWhere, select: { payload: true } });
      if (receipt) {
        const payload = receipt.payload as { userId?: string; kind?: string; status?: SeatStatus } | null;
        return payload?.userId === userId && payload.kind === command.kind ? { ok: true, status: payload.status, replayed: true } : { ok: false, error: "access" };
      }
    }
    if (session.status !== "SCHEDULED" || session.date <= wallClockNow()) return { ok: false, error: "closed" };
    if (command.kind === "capacity" || command.kind === "refresh") {
      if (session.createdById !== userId) return { ok: false, error: "access" };
    }
    // Bloque également une révocation d'invitation pendant l'admission.
    await scopedDb.$queryRaw`SELECT id FROM "SessionInvite" WHERE "sessionId" = ${sessionId} ORDER BY id FOR SHARE`;
    const invites = await scopedDb.sessionInvite.findMany({ where: { sessionId, status: "ACTIVE" }, select: { userId: true } });
    const roster = [session.createdById, ...invites.map(invite => invite.userId)];
    const users = await scopedDb.user.findMany({ where: { id: { in: roster }, ...await communityMemberUserWhere(session.communityId) }, select: { id: true } });
    const eligible = new Set(users.map(user => user.id));
    if (!eligible.has(userId)) return { ok: false, error: "access" };
    await lockCreationMembers(scopedDb, session.communityId, users.map(user => user.id));
    let capacity = session.attendanceCapacity;
    if (command.kind === "capacity") {
      if (!Number.isInteger(command.capacity) || command.capacity < 1 || command.capacity > 100 || (session.decidedGame?.maxPlayers && command.capacity > session.decidedGame.maxPlayers)) return { ok: false, error: "capacity" };
      if (capacity === null) {
        const proposal = await scopedDb.proposal.findFirst({ where: { sessionId, gameId: session.decidedGameId! }, include: { votes: { orderBy: { userId: "asc" } } } });
        const existingSeats = await scopedDb.sessionSeat.findMany({ where: { sessionId, userId: { in: [...eligible] } }, select: { userId: true, status: true } });
        const seatsByUser = new Map(existingSeats.map(seat => [seat.userId, seat.status]));
        const newVoterIds = (proposal?.votes.filter(vote => eligible.has(vote.userId) && !seatsByUser.has(vote.userId)) ?? []).map(vote => vote.userId);
        const alreadyConfirmed = existingSeats.filter(seat => seat.status === "CONFIRMED").length;
        if (alreadyConfirmed + newVoterIds.length > command.capacity) return { ok: false, error: "capacity" };
        await scopedDb.sessionSeat.createMany({ data: newVoterIds.map(userId => ({ sessionId, userId, status: "CONFIRMED" })) });
      } else {
        const confirmed = await scopedDb.sessionSeat.count({ where: { sessionId, status: "CONFIRMED", userId: { in: [...eligible] } } });
        if (command.capacity < confirmed) return { ok: false, error: "capacity" };
      }
      capacity = command.capacity;
      await scopedDb.session.update({ where: { id: sessionId }, data: { attendanceCapacity: capacity } });
    }
    const now = new Date();
    const before = await scopedDb.sessionSeat.findUnique({ where: { sessionId_userId: { sessionId, userId } } });
    if (command.kind === "join" && (!before || before.status === "DECLINED")) {
      await scopedDb.sessionSeat.upsert({ where: { sessionId_userId: { sessionId, userId } }, create: { sessionId, userId, status: capacity === null ? "CONFIRMED" : "WAITLIST", requestedAt: now }, update: { status: capacity === null ? "CONFIRMED" : "WAITLIST", requestedAt: now } });
    } else if (command.kind === "leave" && before && before.status !== "DECLINED") {
      await scopedDb.sessionSeat.update({ where: { sessionId_userId: { sessionId, userId } }, data: { status: "DECLINED" } });
    }
    const rows = await scopedDb.sessionSeat.findMany({ where: { sessionId } });
    const plan = planSessionSeats(rows, eligible, capacity);
    let changed = command.kind === "capacity" || command.kind === "leave" && !!before && before.status !== "DECLINED" || command.kind === "join" && (!before || before.status === "DECLINED");
    for (const row of rows) {
      const status = plan.get(row.userId)!;
      if (status === row.status) continue;
      changed = true;
      await scopedDb.sessionSeat.update({ where: { id: row.id }, data: { status } });
      if (status === "CONFIRMED") await scopedDb.notification.create({ data: { communityId: session.communityId, userId: row.userId, type: "REMINDER", title: "🎮 Ta place est confirmée", message: "Une place est disponible : tu participes à la soirée.", relatedSessionId: sessionId } });
    }
    if (changed && session.announceViaBot) await enqueueSessionAnnounceUpdate(sessionId, scopedDb);
    if (receiptWhere) await scopedDb.notificationEvent.create({ data: { ...receiptWhere.category_eventType_sourceId_occurrence, communityId: session.communityId, payload: { userId, kind: command.kind, status: plan.get(userId) ?? "DECLINED" } } });
    return { ok: true, status: plan.get(userId) };
  }, { timeout: 15_000 });
}
