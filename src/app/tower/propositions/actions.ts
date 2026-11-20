"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { decideTowerProposal, getTowerProposalsCommunityId, proposeTowerChallenge } from "@/lib/tower-challenge-proposals";

function done(path: string, result: string): never {
  revalidatePath(path);
  redirect(`${path}?result=${result}`);
}

async function authorized(path: string, action: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTowerProposalsCommunityId(user.id);
  if (!communityId) redirect(`${path}?result=UNAVAILABLE`);
  if (!checkRateLimit(user.id, action)) done(path, "RATE");
  return { user, communityId };
}

/** Joueur Ranker / High Ranker : dépose une proposition (la communauté vient de la session, jamais du formulaire). */
export async function proposeTowerChallengeAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorized("/tower/propositions", "proposeTowerChallenge");
  const result = await proposeTowerChallenge({
    communityId, userId: user.id,
    content: { title: formData.get("title"), instructions: formData.get("instructions"), rewardFloors: Number(formData.get("rewardFloors")) },
  });
  done("/tower/propositions", result.status);
}

/** Staff (OWNER/ADMIN, revérifié en base) : approuve ou rejette. */
export async function decideTowerProposalAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorized("/admin/tower-propositions", "decideTowerProposal");
  const result = await decideTowerProposal({
    communityId, userId: user.id,
    decision: { proposalId: formData.get("proposalId"), approve: formData.get("decision") === "approve", note: String(formData.get("note") ?? "") || undefined },
  });
  done("/admin/tower-propositions", result.status);
}
