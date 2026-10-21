import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findExistingDefaultCommunityId } from "@/lib/default-community";

export async function lockCreationMembers(tx: Prisma.TransactionClient, communityId: string | null, userIds: string[]): Promise<void> {
  // Un parent historique null reste historique : seul son accès hérité au
  // serveur default est contrôlé, sans réaffecter la provenance du parent.
  communityId ??= await findExistingDefaultCommunityId(tx);
  if (!communityId) throw new Error("Choisis un serveur accessible avant de créer.");
  // Le CTE membres dépend du CTE materialisé de communauté : verrou Community avant Membership.
  const rows = await tx.$queryRaw<Array<{ communityStatus: string; userId: string | null; membershipStatus: string | null }>>`
    WITH locked_community AS MATERIALIZED (
      SELECT id, status FROM "Community" WHERE id = ${communityId} FOR SHARE
    ), locked_members AS MATERIALIZED (
      SELECT m."userId", m.status
      FROM "Membership" m
      JOIN locked_community c ON c.id = m."communityId"
      WHERE m."userId" = ANY(${[...new Set(userIds)]}::text[])
      ORDER BY m."userId"
      FOR SHARE OF m
    )
    SELECT c.status AS "communityStatus", m."userId", m.status AS "membershipStatus"
    FROM locked_community c
    LEFT JOIN locked_members m ON TRUE
  `;
  if (rows[0]?.communityStatus !== "ACTIVE" || userIds.some((id) => !rows.some((row) => row.userId === id && row.membershipStatus === "ACTIVE"))) {
    throw new Error("Le serveur ou un invité n’est plus accessible. Actualise la sélection et réessaie.");
  }
}

export function creationKey(value: unknown, required = false): string | undefined {
  if ((value === null || value === undefined || value === "") && !required) return undefined;
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) {
    throw new Error("La tentative de création est invalide. Recharge le formulaire.");
  }
  return value;
}

/** La clé représente un geste, pas son contenu : deux formulaires identiques
 * avec des clés différentes restent deux créations volontaires. Le verrou et
 * le reçu partagent la transaction métier : rollback = tentative réutilisable.
 * Les reçus restent durables après purge du parent (aucune FK vers lui). */
export async function createOnce<T>(
  actorId: string,
  kind: string,
  key: string | undefined,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
  resourceId: (result: T) => string,
  replay: (tx: Prisma.TransactionClient, id: string) => Promise<T>,
  transaction?: Prisma.TransactionClient,
): Promise<{ result: T; replayed: boolean }> {
  const execute = async (tx: Prisma.TransactionClient) => {
    if (!key) return { result: await create(tx), replayed: false };
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actorId, kind, key])}, 0))::text`;
    const where = { actorId_kind_key: { actorId, kind, key } };
    const receipt = await tx.creationIntent.findUnique({ where });
    if (receipt) return { result: await replay(tx, receipt.resourceId), replayed: true };
    const result = await create(tx);
    await tx.creationIntent.create({ data: { actorId, kind, key, resourceId: resourceId(result) } });
    return { result, replayed: false };
  };
  return transaction ? execute(transaction) : prisma.$transaction(execute, { timeout: 15_000, maxWait: 10_000 });
}
