import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { getDefaultCommunityId } from "@/lib/default-community";
import { isVoteVetoEnabled } from "@/lib/session-veto";

/** Ids des propositions vetoées d'une soirée. Flag éteint : ensemble vide, aucune requête. */
export async function loadVetoedProposalIds(sessionId: string, communityId: string | null): Promise<Set<string>> {
  if (!isVoteVetoEnabled()) return new Set();
  const scopedDb = await scopedPrismaForCommunityId(communityId ?? (await getDefaultCommunityId()));
  const rows = await scopedDb.sessionVeto.findMany({ where: { sessionId }, select: { proposalId: true } });
  return new Set(rows.map((r) => r.proposalId));
}

/** Vetos d'une soirée (anonymes : jamais de nom d'auteur). Flag éteint : liste vide. */
export async function loadSessionVetoes(sessionId: string, communityId: string | null) {
  if (!isVoteVetoEnabled()) return [];
  const scopedDb = await scopedPrismaForCommunityId(communityId ?? (await getDefaultCommunityId()));
  const rows = await scopedDb.sessionVeto.findMany({
    where: { sessionId },
    select: { proposalId: true, userId: true },
  });
  return rows;
}
