import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getIsolationScope, isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { getDefaultCommunityId } from "@/lib/default-community";
import { isSessionAnnounceViaBotEnabledFor, pickCreationCommunityId } from "@/lib/community-channels";
import { requireCommunityBotAnnouncement } from "@/lib/community-announcement-required";
import { createVotingSessionInTransaction } from "@/lib/session-creation";
import { createOnce } from "@/lib/creation-intent";
import { availabilityPollAnswerSchema, parseAvailabilityPollInput } from "@/lib/session-availability-poll";
import { formatDateTimeFr, toDateInputValue, toTimeInputValue, wallClockNow } from "@/lib/wallclock";
import { resolveSessionSchedule, SESSION_SCHEDULE_ERROR_MESSAGES } from "@/lib/session-schedule";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";

export class AvailabilityPollError extends Error {
  constructor(message = "Ce sondage n'est plus accessible.") {
    super(message);
    this.name = "AvailabilityPollError";
  }
}

const privateAudience = (userId: string) => ({ OR: [{ createdById: userId }, { participants: { some: { userId } } }] });
const pollInclude = {
  participants: { select: { userId: true, user: { select: { id: true, discordName: true } } } },
  slots: { orderBy: { start: "asc" as const }, include: { responses: { select: { userId: true, answer: true } } } },
};

/** Verrouille aussi les révocations concurrentes. Le défaut historique OFF
 * accepte un compte sans Membership, mais jamais une appartenance révoquée.
 * Un serveur nondefault exige toujours un membre ACTIVE. */
async function lockPollAudience(tx: Prisma.TransactionClient, communityId: string, userIds: string[]) {
  const [community] = await tx.$queryRaw<Array<{ status: string; slug: string }>>`
    SELECT status, slug FROM "Community" WHERE id = ${communityId} FOR SHARE
  `;
  const users = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "User" WHERE id = ANY(${userIds}::text[]) ORDER BY id FOR UPDATE
  `;
  const members = await tx.$queryRaw<Array<{ userId: string; status: string }>>`
    SELECT "userId", status FROM "Membership" WHERE "communityId" = ${communityId}
    AND "userId" = ANY(${userIds}::text[]) ORDER BY "userId" FOR SHARE
  `;
  const membershipRequired = isCommunityIsolationEnabled() || community?.slug !== "default";
  if (community?.status !== "ACTIVE" || users.length !== userIds.length || userIds.some(userId => {
    const member = members.find(row => row.userId === userId);
    return member ? member.status !== "ACTIVE" : membershipRequired;
  })) throw new AvailabilityPollError("Le serveur ou un participant n'est plus accessible. Actualise la sélection.");
}

async function lockedPoll(tx: Prisma.TransactionClient, userId: string, pollId: string, exclusive: boolean, allParticipants = false) {
  const scopedDb = scopedTransactionPrisma(tx, await getIsolationScope(userId));
  const where = { id: pollId, ...privateAudience(userId) };
  // Vérifier l'accès avant de verrouiller, puis relire après le verrou : un ID
  // connu ne donne ni accès ni possibilité de bloquer un sondage étranger.
  if (!(await scopedDb.sessionAvailabilityPoll.findFirst({ where, select: { id: true } }))) throw new AvailabilityPollError();
  if (exclusive) await tx.$queryRaw`SELECT id FROM "SessionAvailabilityPoll" WHERE id = ${pollId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "SessionAvailabilityPoll" WHERE id = ${pollId} FOR SHARE`;
  const poll = await scopedDb.sessionAvailabilityPoll.findFirst({ where, include: pollInclude });
  if (!poll) throw new AvailabilityPollError();
  // Le choix verrouille d'emblée TOUS les utilisateurs en ordre global.
  // Ne pas verrouiller le créateur seul puis élargir : deux sondages avec
  // organisateurs différents pourraient prendre les utilisateurs à l'envers.
  const needsRosterLock = allParticipants && !poll.sessionId && !poll.chosenSlotId;
  await lockPollAudience(tx, poll.communityId, needsRosterLock ? poll.participants.map(row => row.userId) : [userId]);
  return { poll, scopedDb };
}

export async function createAvailabilityPoll(userId: string, rawInput: unknown, idempotencyKey?: string) {
  const input = parseAvailabilityPollInput(rawInput, wallClockNow());
  if (!input.ok || !input.participantIds.includes(userId)) throw new AvailabilityPollError("Les créneaux ou participants du sondage sont invalides.");
  const selectedCommunity = await pickCreationCommunityId(userId);
  if (isCommunityIsolationEnabled() && selectedCommunity === null) throw new AvailabilityPollError();
  const communityId = selectedCommunity ?? await getDefaultCommunityId();
  return prisma.$transaction(async tx => {
    const { result, replayed } = await createOnce(userId, "AVAILABILITY_POLL", idempotencyKey, async transaction => {
      await lockPollAudience(transaction, communityId, input.participantIds);
      const scopedDb = scopedTransactionPrisma(transaction, { communityIds: [communityId], includesDefault: false });
      // Parent + liste de participants + options atomiques. Aucune Session,
      // récompense ou intention Discord n'existe à ce stade.
      return scopedDb.sessionAvailabilityPoll.create({ data: {
        title: input.title, createdById: userId, communityId,
        participants: { create: input.participantIds.map(userId => ({ userId })) },
        slots: { create: input.slots },
      }, select: { id: true } });
    }, row => row.id, async (transaction, id) => {
      const scopedDb = scopedTransactionPrisma(transaction, await getIsolationScope(userId));
      const existing = await scopedDb.sessionAvailabilityPoll.findFirst({
        where: { id, createdById: userId },
        select: { id: true, communityId: true, participants: { select: { userId: true } } },
      });
      if (!existing) throw new AvailabilityPollError("Cette création n'est plus accessible. Aucune nouvelle n'a été faite.");
      await lockPollAudience(transaction, existing.communityId, existing.participants.map(row => row.userId));
      return { id: existing.id };
    }, tx);
    return { ...result, replayed };
  }, { timeout: 15_000 });
}

export async function loadAvailabilityPoll(userId: string, pollId: string) {
  // Une transaction partagée garde l'accès et les appartenances cohérents
  // jusqu'au chargement de la grille. Les plannings bruts n'en font pas partie.
  return prisma.$transaction(async tx => (await lockedPoll(tx, userId, pollId, false)).poll, { timeout: 15_000 });
}

export async function listAvailabilityPolls(userId: string) {
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.sessionAvailabilityPoll.findMany({
    where: { community: { status: "ACTIVE" }, AND: [privateAudience(userId), { OR: [
      { community: { memberships: { some: { userId, status: "ACTIVE" } } } },
      // Sous OFF, seul default accepte un compte historique sans membership.
      { community: { slug: "default", memberships: { none: { userId, status: { not: "ACTIVE" } } } } },
    ] }],
    },
    select: { id: true, title: true, status: true, sessionId: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 50,
  });
}

export async function answerAvailabilityPoll(userId: string, pollId: string, slotId: string, rawAnswer: unknown) {
  const parsed = availabilityPollAnswerSchema.nullable().safeParse(rawAnswer);
  if (!parsed.success) throw new AvailabilityPollError("Réponse invalide.");
  return prisma.$transaction(async tx => {
    const { poll, scopedDb } = await lockedPoll(tx, userId, pollId, false);
    if (poll.status !== "OPEN" || !poll.participants.some(participant => participant.userId === userId) || !poll.slots.some(slot => slot.id === slotId)) throw new AvailabilityPollError();
    const where = { pollId_slotId_userId: { pollId, slotId, userId } };
    if (parsed.data === null) {
      await scopedDb.sessionAvailabilityPollResponse.deleteMany({ where: { pollId, slotId, userId } });
    } else {
      await scopedDb.sessionAvailabilityPollResponse.upsert({ where,
        create: { pollId, slotId, userId, answer: parsed.data }, update: { answer: parsed.data },
      });
    }
  }, { timeout: 15_000 });
}

export async function closeAvailabilityPoll(userId: string, pollId: string) {
  return prisma.$transaction(async tx => {
    const { poll, scopedDb } = await lockedPoll(tx, userId, pollId, true);
    if (poll.createdById !== userId) throw new AvailabilityPollError();
    await scopedDb.sessionAvailabilityPoll.update({ where: { id: poll.id }, data: { status: "CLOSED" } });
  }, { timeout: 15_000 });
}

/** Le parent exclusif sérialise choix, clôture et réponses (verrou partagé).
 * Une nouvelle clé de formulaire ne peut pas produire une deuxième soirée. */
export async function chooseAvailabilityPollSlot(userId: string, pollId: string, slotId: string) {
  return prisma.$transaction(async tx => {
    const { poll, scopedDb } = await lockedPoll(tx, userId, pollId, true, true);
    if (poll.createdById !== userId) throw new AvailabilityPollError();
    if (poll.sessionId) {
      const session = await scopedDb.session.findUniqueOrThrow({ where: { id: poll.sessionId } });
      return { session, replayed: true };
    }
    if (poll.chosenSlotId) throw new AvailabilityPollError("La soirée créée depuis ce sondage a été supprimée ; ce choix ne peut pas être rejoué.");
    const slot = poll.slots.find(option => option.id === slotId);
    if (!slot || slot.start <= wallClockNow()) throw new AvailabilityPollError("Choisis un créneau futur dans ce sondage.");
    const schedule = resolveSessionSchedule({
      dateStr: toDateInputValue(slot.start), timeStr: toTimeInputValue(slot.start),
      deadlineDateStr: "", deadlineTimeStr: "", deadlineOffset: "6",
    });
    if (!schedule.ok) throw new AvailabilityPollError(SESSION_SCHEDULE_ERROR_MESSAGES[schedule.error]);
    const participants = poll.participants.map(participant => participant.userId);
    const announceViaBot = await isSessionAnnounceViaBotEnabledFor(poll.communityId);
    await requireCommunityBotAnnouncement(poll.communityId, announceViaBot);
    const session = await createVotingSessionInTransaction(tx, {
      createdById: userId, communityId: poll.communityId, date: slot.start,
      votingDeadline: schedule.votingDeadline, customReminderMessage: null, reminderTimings: [1440, 120],
      notifiedUserIds: participants.filter(id => id !== userId), announceViaBot,
    });
    if (!announceViaBot) {
      const candidates = await tx.user.findMany({
        where: { id: { in: participants.filter(id => id !== userId) } },
        select: { id: true, silenceReminders: true },
      });
      const recipients = await filterUsersByNotificationPreference(candidates, "SESSION", tx);
      if (recipients.length) await scopedDb.notification.createMany({ data: recipients.map(recipient => ({
        communityId: poll.communityId, userId: recipient.id, type: "SESSION_CREATED",
        title: "📣 Nouvelle soirée", message: formatDateTimeFr(session.date), relatedSessionId: session.id,
      })) });
    }
    await scopedDb.sessionAvailabilityPoll.update({ where: { id: poll.id }, data: {
      status: "CLOSED", chosenSlotId: slot.id, sessionId: session.id,
    } });
    return { session, replayed: false };
  }, { timeout: 15_000 });
}
