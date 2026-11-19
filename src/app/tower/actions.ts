"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { replaceTowerChallenge } from "@/lib/tower-challenge-replacement";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { submitTowerChallengeAppeal } from "@/lib/tower-challenges";

export type TowerAppealFormState = { status: string };

export async function submitTowerChallengeAppealAction(
  _previous: TowerAppealFormState,
  formData: FormData,
): Promise<TowerAppealFormState> {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return { status: "UNAVAILABLE" };
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) return { status: "UNAVAILABLE" };
  const result = await submitTowerChallengeAppeal({
    communityId,
    userId: user.id,
    attemptId: String(formData.get("attemptId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (result.status === "APPEAL_SUBMITTED") revalidatePath("/tower");
  return { status: result.status };
}

/** Remplace le défi solo en cours quand son jeu n'est pas possédé (communauté active de l'acteur, jamais celle du formulaire). */
export async function replaceTowerChallengeAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) redirect("/tower?remplacement=UNAVAILABLE");
  if (!checkRateLimit(user.id, "replaceTowerChallenge")) redirect("/tower?remplacement=RATE");
  const result = await replaceTowerChallenge({ communityId, userId: user.id, attemptId: String(formData.get("attemptId") ?? "") });
  revalidatePath("/tower");
  redirect(`/tower?remplacement=${result.status}`);
}
