"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { teamApplicationSchema } from "@/lib/team-applications-rules";
import { applyToTeam, decideTeamApplication, getTeamApplicationsCommunityId, withdrawTeamApplication } from "@/lib/team-applications";
import { notifyApproversOfApplication } from "@/lib/team-application-approvers";

function done(result: string): never {
  revalidatePath("/equipes/candidatures");
  redirect(`/equipes/candidatures?result=${result}`);
}

async function authorizedUser(action: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTeamApplicationsCommunityId(user.id);
  if (!communityId) redirect("/equipes/candidatures?result=unavailable");
  if (!checkRateLimit(user.id, action)) done("rate");
  return { user, communityId };
}

export async function applyToTeamAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("applyToTeam");
  const input = teamApplicationSchema.safeParse({ teamId: formData.get("teamId"), message: formData.get("message") });
  if (!input.success) done("invalid");
  const result = await applyToTeam(user.id, communityId, input.data);
  if (result === "applied") await notifyApproversOfApplication(communityId, input.data.teamId, user.id);
  done(result);
}

export async function withdrawTeamApplicationAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("withdrawTeamApplication");
  const applicationId = idSchema.safeParse(formData.get("applicationId"));
  if (!applicationId.success) done("invalid");
  done(await withdrawTeamApplication(user.id, communityId, applicationId.data));
}

export async function decideTeamApplicationAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("decideTeamApplication");
  const applicationId = idSchema.safeParse(formData.get("applicationId"));
  const decision = formData.get("decision");
  if (!applicationId.success || (decision !== "accept" && decision !== "decline")) done("invalid");
  done(await decideTeamApplication(user.id, communityId, applicationId.data, decision === "accept"));
}
