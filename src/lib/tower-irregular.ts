import { effectiveCommunityRole } from "@/lib/community-staff-role";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { canManageTowerIrregular, isTowerIrregularGrantsEnabled, towerIrregularTargetSchema } from "@/lib/tower-irregular-rules";

export type TowerIrregularResult = "granted" | "already" | "revoked" | "not_granted" | "forbidden" | "not_member" | "invalid" | "unavailable";

const TX = { timeout: 5000, maxWait: 1000 } as const;

function enabled(): boolean {
  return isTowerIrregularGrantsEnabled() && process.env.TOWER_CHALLENGES_ENABLED === "true";
}

/** Communauté active du membre si les drapeaux sont allumés (l'appartenance est revérifiée à chaque écriture). */
export async function getTowerIrregularCommunityId(userId: string): Promise<string | null> {
  if (!enabled()) return null;
  return resolveActiveCommunityId(userId);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Revérifie en base, dans la transaction, que l'acteur est ACTIVE dans une communauté ACTIVE dont la Tour est allumée. */
async function actorRole(tx: Tx, actorId: string, communityId: string): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ role: string }[]>`
    SELECT m.role FROM "Membership" m JOIN "Community" c ON c.id = m."communityId"
    WHERE m."userId" = ${actorId} AND m."communityId" = ${communityId} AND m.status = 'ACTIVE'
      AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
    FOR SHARE OF m, c
  `;
  return row ? effectiveCommunityRole(tx, actorId, row.role) : null;
}

async function change(actorId: string, communityId: string, input: unknown, grant: boolean): Promise<TowerIrregularResult> {
  if (!enabled()) return "unavailable";
  const parsed = towerIrregularTargetSchema.safeParse(input);
  if (!parsed.success) return "invalid";
  const { userId } = parsed.data;
  return prisma.$transaction(async tx => {
    const role = await actorRole(tx, actorId, communityId);
    if (role === null) return "unavailable";
    if (!canManageTowerIrregular(role)) return "forbidden";
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const target = await tx.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { status: true } });
    const current = await scopedDb.towerIrregularGrant.findFirst({ where: { communityId, userId }, select: { revokedAt: true } });
    const active = current !== null && current.revokedAt === null;
    const now = new Date();
    if (grant) {
      if (target?.status !== "ACTIVE") return "not_member";
      if (active) return "already";
      if (current) {
        await scopedDb.towerIrregularGrant.update({
          where: { communityId_userId: { communityId, userId } },
          data: { grantedById: actorId, grantedAt: now, revokedAt: null, revokedById: null },
        });
      } else {
        await scopedDb.towerIrregularGrant.create({ data: { communityId, userId, grantedById: actorId, grantedAt: now } });
      }
      await scopedDb.towerIrregularLog.create({ data: { communityId, userId, actorId, action: "GRANTED", createdAt: now } });
      return "granted";
    }
    if (!active) return "not_granted";
    await scopedDb.towerIrregularGrant.update({
      where: { communityId_userId: { communityId, userId } }, data: { revokedAt: now, revokedById: actorId },
    });
    await scopedDb.towerIrregularLog.create({ data: { communityId, userId, actorId, action: "REVOKED", createdAt: now } });
    return "revoked";
  }, TX);
}

export const grantTowerIrregular = (actorId: string, communityId: string, input: unknown) => change(actorId, communityId, input, true);
export const revokeTowerIrregular = (actorId: string, communityId: string, input: unknown) => change(actorId, communityId, input, false);

/** Liste (staff seulement) : membres ACTIFS avec leur état Irregular, plus le journal récent. */
export async function listTowerIrregularForStaff(actorId: string, communityId: string) {
  if (!enabled()) return { status: "UNAVAILABLE" } as const;
  return prisma.$transaction(async tx => {
    const role = await actorRole(tx, actorId, communityId);
    if (role === null) return { status: "UNAVAILABLE" } as const;
    if (!canManageTowerIrregular(role)) return { status: "FORBIDDEN" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const [members, grants, log] = await Promise.all([
      tx.membership.findMany({
        where: { communityId, status: "ACTIVE" }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], take: 200,
        select: { userId: true, user: { select: { discordName: true } } },
      }),
      scopedDb.towerIrregularGrant.findMany({ where: { communityId, revokedAt: null }, select: { userId: true, grantedAt: true } }),
      scopedDb.towerIrregularLog.findMany({
        where: { communityId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
        select: { id: true, action: true, createdAt: true, user: { select: { discordName: true } }, actor: { select: { discordName: true } } },
      }),
    ]);
    const granted = new Map(grants.map(grant => [grant.userId, grant.grantedAt]));
    return {
      status: "LISTED",
      members: members.map(member => ({ userId: member.userId, displayName: member.user.discordName, grantedAt: granted.get(member.userId) ?? null })),
      log: log.map(entry => ({ id: entry.id, action: entry.action, createdAt: entry.createdAt, displayName: entry.user.discordName, actorName: entry.actor?.discordName ?? null })),
    } as const;
  }, TX);
}
