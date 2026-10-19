import type { Prisma, Session } from "@prisma/client";
import { lockCreationMembers } from "@/lib/creation-intent";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { createInitialSessionInvites } from "@/lib/session-access";
import { enqueueSessionCreationDeliveries, enqueueSessionInviteSyncForNewInvites } from "@/lib/session-announce";

export type VotingSessionInput = Pick<Session,
  "createdById" | "communityId" | "date" | "votingDeadline" |
  "customReminderMessage" | "reminderTimings" | "announceViaBot"
> & { notifiedUserIds: string[]; recurrenceGroupId?: string | null };

/** Création et intentions bot atomiques, sans appel réseau. La transaction
 * appartient à l'appelant : formulaire habituel ou choix final d'un sondage.
 * Le créateur conserve son accès propre ; seuls les invités sélectionnés
 * reçoivent une SessionInvite et une synchronisation du fil privé. */
export async function createVotingSessionInTransaction(
  tx: Prisma.TransactionClient,
  input: VotingSessionInput,
): Promise<Session> {
  await lockCreationMembers(tx, input.communityId, [input.createdById, ...input.notifiedUserIds]);
  // La portée fournie ici vient des appartenances verrouillées ci-dessus,
  // jamais d'une simple préférence de serveur reçue du navigateur.
  const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled()
    ? { communityIds: input.communityId ? [input.communityId] : [], includesDefault: input.communityId === null }
    : null);
  const created = await scopedDb.session.create({ data: input });
  const invites = await createInitialSessionInvites(created, input.createdById, input.notifiedUserIds, tx);
  if (input.announceViaBot) {
    await enqueueSessionCreationDeliveries(created.id, tx, undefined, created.communityId);
    await enqueueSessionInviteSyncForNewInvites(created, invites.map(invite => invite.id), tx);
  }
  return created;
}
