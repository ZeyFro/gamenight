"use server";

import { revalidatePath } from "next/cache";
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
