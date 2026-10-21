import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function lockCreationMembers(tx: Prisma.TransactionClient, communityId: string | null, userIds: string[]): Promise<void> {
  // Un parent historique null reste historique : seul son accès hérité au
  // serveur default est contrôlé, sans réaffecter la provenance du parent.
  communityId ??= (await tx.community.findUnique({ where: { slug: "default" }, select: { id: true } }))?.id ?? null;
  if (!communityId) throw new Error("Choisis un serveur accessible avant de créer.");
  const [community] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "Community" WHERE id = ${communityId} FOR SHARE`;
  const members = await tx.$queryRaw<Array<{ userId: string; status: string }>>`
    SELECT "userId", status FROM "Membership"
    WHERE "communityId" = ${communityId} AND "userId" = ANY(${[...new Set(userIds)]}::text[])
    ORDER BY "userId" FOR SHARE
  `;
  if (community?.status !== "ACTIVE" || userIds.some((id) => !members.some((m) => m.userId === id && m.status === "ACTIVE"))) {
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
  return transaction ? execute(transaction) : prisma.$transaction(execute, { timeout: 15_000 });
}
