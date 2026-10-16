import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getIsolationScope, communityMemberUserWhere } from "@/lib/community-isolation";
import { accessibleSessionWhere } from "@/lib/session-access";
import { lockCreationMembers } from "@/lib/creation-intent";
import { isSessionPreparationEnabled } from "@/lib/session-preparation-config";

export const preparationInput = z.object({
  sessionId: z.string().min(1).max(128),
  field: z.enum(["installed", "updated", "microphone", "lobby"]),
  checked: z.boolean(),
}).strict();

// Le parent autorisé porte toutes les lectures et écritures enfant.
async function withPreparation(userId: string, sessionId: string, change?: { field: "installed" | "updated" | "microphone" | "lobby"; checked: boolean }) {
  if (!isSessionPreparationEnabled()) return null;
  const scope = await getIsolationScope(userId);
  return prisma.$transaction(async tx => {
    const scopedDb = scopedTransactionPrisma(tx, scope);
    const where = { id: sessionId, ...accessibleSessionWhere(userId, scope) };
    if (!await scopedDb.session.findFirst({ where, select: { id: true } })) return null;
    await scopedDb.$queryRaw`SELECT id FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
    await scopedDb.$queryRaw`SELECT id FROM "SessionInvite" WHERE "sessionId" = ${sessionId} ORDER BY id FOR SHARE`;
    const session = await scopedDb.session.findFirst({ where, include: {
      seats: { where: { status: "CONFIRMED" }, select: { userId: true } },
      proposals: { select: { gameId: true, votes: { select: { userId: true } } } },
      invites: { where: { status: "ACTIVE" }, select: { userId: true } },
    } });
    if (!session || session.status !== "SCHEDULED" || !session.decidedGameId) return null;
    await lockCreationMembers(scopedDb, session.communityId, [userId]);
    const audience = [session.createdById, ...session.invites.map(row => row.userId)];
    const roster = session.attendanceCapacity !== null ? session.seats : session.proposals.find(row => row.gameId === session.decidedGameId)?.votes ?? [];
    const participants = await scopedDb.user.findMany({ where: {
      AND: [{ id: { in: roster.map(row => row.userId) } }, { id: { in: audience } }],
      ...await communityMemberUserWhere(session.communityId),
    }, select: { id: true, discordName: true }, orderBy: { discordName: "asc" } });
    if (change) {
      if (!participants.some(row => row.id === userId)) return null;
      await scopedDb.session.update({ where: { id: sessionId }, data: { preparations: { upsert: {
        where: { sessionId_userId_gameId: { sessionId, userId, gameId: session.decidedGameId } },
        create: { userId, gameId: session.decidedGameId, [change.field]: change.checked },
        update: { [change.field]: change.checked },
      } } } });
    }
    const parent = await scopedDb.session.findFirst({ where, select: { preparations: {
      where: { gameId: session.decidedGameId, userId: { in: participants.map(row => row.id) } },
      select: { userId: true, installed: true, updated: true, microphone: true, lobby: true },
    } } });
    if (!parent) return null;
    return participants.map(person => ({ ...person, installed: false, updated: false, microphone: false, lobby: false,
      ...parent.preparations.find(row => row.userId === person.id),
    }));
  });
}
export async function readSessionPreparation(userId: string, sessionId: string) {
  return withPreparation(userId, sessionId);
}
export async function changeSessionPreparation(userId: string, raw: unknown) {
  const parsed = preparationInput.safeParse(raw);
  if (!parsed.success) return false;
  return (await withPreparation(userId, parsed.data.sessionId, parsed.data)) !== null;
}
