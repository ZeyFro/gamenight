"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { configureTowerChallengeArbiter, appointTowerChallengeArbiter, decideTowerChallengeAppeal } from "@/lib/tower-challenges";
import { recordSensitiveOperation } from "@/lib/sensitive-operation-log";

export type TowerAppealReviewState = { status: string };

async function getActor() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return null;
  const communityId = await resolveActiveCommunityId(user.id);
  return communityId ? { userId: user.id, communityId } : null;
}

export async function decideTowerChallengeAppealAction(
  _previous: TowerAppealReviewState,
  formData: FormData,
): Promise<TowerAppealReviewState> {
  const actor = await getActor();
  if (!actor) return { status: "FORBIDDEN" };
  const result = await decideTowerChallengeAppeal({
    ...actor,
    appealId: String(formData.get("appealId") ?? ""),
    decision: String(formData.get("decision") ?? ""),
    decisionReason: String(formData.get("decisionReason") ?? ""),
  });
  revalidatePath("/admin/tower-appeals");
  revalidatePath("/tower");
  await recordSensitiveOperation({ actorId: actor.userId, action: "tower.appeal_decide", communityId: actor.communityId, target: String(formData.get("appealId") ?? ""), outcome: result.status });
  return { status: result.status };
}

export async function appointTowerChallengeArbiterAction(
  _previous: TowerAppealReviewState,
  formData: FormData,
): Promise<TowerAppealReviewState> {
  const actor = await getActor();
  if (!actor) return { status: "FORBIDDEN" };
  const result = await appointTowerChallengeArbiter({
    ...actor,
    appealId: String(formData.get("appealId") ?? ""),
    arbiterUserId: String(formData.get("arbiterUserId") ?? ""),
  });
  revalidatePath("/admin/tower-appeals");
  await recordSensitiveOperation({ actorId: actor.userId, action: "tower.arbiter_appoint", communityId: actor.communityId, target: String(formData.get("appealId") ?? ""), outcome: result.status });
  return { status: result.status };
}

export async function configureTowerChallengeArbiterAction(_previous: TowerAppealReviewState, formData: FormData): Promise<TowerAppealReviewState> {
  const actor = await getActor();
  if (!actor) return {status:"FORBIDDEN"};
  const result=await configureTowerChallengeArbiter({...actor,arbiterUserId:String(formData.get("arbiterUserId") ?? "")});
  revalidatePath("/admin/tower-appeals");
  await recordSensitiveOperation({ actorId: actor.userId, action: "tower.arbiter_configure", communityId: actor.communityId, target: String(formData.get("arbiterUserId") ?? ""), outcome: result.status });
  return {status:result.status};
}
