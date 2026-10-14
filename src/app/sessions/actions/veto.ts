"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { getDefaultCommunityId } from "@/lib/default-community";
import { getProposalAvailability, isVotingOpen } from "@/lib/sessions";
import { canAccessSession } from "@/lib/session-access";
import { isVoteVetoEnabled, wouldVetoLeaveCandidate } from "@/lib/session-veto";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import { toggleVoteSchema } from "@/lib/validations";

export interface VetoResult {
  ok: boolean;
  /** disabled | rate_limited | invalid | forbidden | closed | last_candidate */
  error?: string;
}

/** Charge la proposition et sa soirée via le client scopé ; `null` si introuvable ou hors périmètre. */
async function loadContext(userId: string, proposalId: string) {
  const scopedDb = await getScopedPrisma(userId);
  const proposal = await scopedDb.proposal.findUnique({ where: { id: proposalId }, select: { sessionId: true } });
  if (!proposal) return null;
  const session = await scopedDb.session.findUnique({
    where: { id: proposal.sessionId },
    include: { proposals: { include: { game: true } } },
  });
  return session ? { scopedDb, session } : null;
}

async function prepare(formData: FormData) {
  if (!isVoteVetoEnabled()) return { fail: { ok: false, error: "disabled" } as VetoResult };
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "setVeto")) return { fail: { ok: false, error: RATE_LIMIT_ERROR_KEY } as VetoResult };
  const input = toggleVoteSchema.safeParse({ proposalId: String(formData.get("proposalId") ?? "") });
  if (!input.success) return { fail: { ok: false, error: "invalid" } as VetoResult };
  const ctx = await loadContext(user.id, input.data.proposalId);
  if (!ctx || !(await canAccessSession(user.id, ctx.session.id))) {
    return { fail: { ok: false, error: "forbidden" } as VetoResult };
  }
  if (!isVotingOpen(ctx.session)) return { fail: { ok: false, error: "closed" } as VetoResult };
  return { user, proposalId: input.data.proposalId, ...ctx };
}

/** Pose son veto (un seul par soirée : un nouveau veto remplace le précédent). */
export async function setVeto(formData: FormData): Promise<VetoResult> {
  const r = await prepare(formData);
  if (r.fail) return r.fail;
  const { user, proposalId, scopedDb, session } = r;

  const availability = await getProposalAvailability(
    session.date,
    session.proposals.map((p) => p.game)
  );
  const jouableIds = session.proposals.filter((p) => availability.get(p.gameId)?.jouable).map((p) => p.id);
  const others = await scopedDb.sessionVeto.findMany({
    where: { sessionId: session.id, NOT: { userId: user.id } },
    select: { proposalId: true },
  });
  if (!wouldVetoLeaveCandidate(jouableIds, new Set(others.map((v) => v.proposalId)), proposalId)) {
    return { ok: false, error: "last_candidate" };
  }

  const communityId = session.communityId ?? (await getDefaultCommunityId());
  await scopedDb.sessionVeto.upsert({
    where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
    update: { proposalId },
    create: { sessionId: session.id, userId: user.id, proposalId, communityId },
  });
  revalidatePath(`/sessions/${session.id}`);
  return { ok: true };
}

/** Retire son veto (sans effet s'il n'y en a pas). */
export async function clearVeto(formData: FormData): Promise<VetoResult> {
  const r = await prepare(formData);
  if (r.fail) return r.fail;
  await r.scopedDb.sessionVeto.deleteMany({ where: { sessionId: r.session.id, userId: r.user.id } });
  revalidatePath(`/sessions/${r.session.id}`);
  return { ok: true };
}
