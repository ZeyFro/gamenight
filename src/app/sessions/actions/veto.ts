"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getIsolationScope } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
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
  const { user, proposalId, session } = r;

  const availability = await getProposalAvailability(
    session.date,
    session.proposals.map((p) => p.game)
  );
  const jouableIds = session.proposals.filter((p) => availability.get(p.gameId)?.jouable).map((p) => p.id);
  const communityId = session.communityId ?? (await getDefaultCommunityId());
  const scope = await getIsolationScope(user.id);
  // Verrou de ligne sur la soirée : deux vetos simultanés sont sérialisés, le second voit le premier.
  const allowed = await prisma.$transaction(async (tx) => {
    const scopedDb = scopedTransactionPrisma(tx, scope);
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${session.id} FOR UPDATE`;
    const fresh = await scopedDb.session.findUnique({ where: { id: session.id } });
    if (!fresh || !isVotingOpen(fresh)) return "closed" as const;
    const others = await scopedDb.sessionVeto.findMany({
      where: { sessionId: session.id, NOT: { userId: user.id } },
      select: { proposalId: true },
    });
    if (!wouldVetoLeaveCandidate(jouableIds, new Set(others.map((v) => v.proposalId)), proposalId)) return "last_candidate" as const;
    await scopedDb.sessionVeto.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
      update: { proposalId },
      create: { sessionId: session.id, userId: user.id, proposalId, communityId },
    });
    return null;
  });
  if (allowed) return { ok: false, error: allowed };
  revalidatePath(`/sessions/${session.id}`);
  return { ok: true };
}

/** Retire son veto (sans effet s'il n'y en a pas). */
export async function clearVeto(formData: FormData): Promise<VetoResult> {
  const r = await prepare(formData);
  if (r.fail) return r.fail;
  const scope = await getIsolationScope(r.user.id);
  const cleared = await prisma.$transaction(async (tx) => {
    const scopedDb = scopedTransactionPrisma(tx, scope);
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${r.session.id} FOR UPDATE`;
    const fresh = await scopedDb.session.findUnique({ where: { id: r.session.id } });
    if (!fresh || !isVotingOpen(fresh)) return false;
    // Un bouton obsolète ne doit jamais retirer le veto d'une autre proposition.
    await scopedDb.sessionVeto.deleteMany({ where: { sessionId: r.session.id, userId: r.user.id, proposalId: r.proposalId } });
    return true;
  });
  if (!cleared) return { ok: false, error: "closed" };
  revalidatePath(`/sessions/${r.session.id}`);
  return { ok: true };
}
