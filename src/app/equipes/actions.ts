"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCommunityTeamsCommunityId, createCommunityTeam, joinCommunityTeam, leaveCommunityTeam, setCommunityTeamRecruitment } from "@/lib/community-teams";
import { communityTeamSchema } from "@/lib/community-teams-rules";
import { idSchema } from "@/lib/validations";

function done(result: string): never {
  revalidatePath("/equipes");
  redirect(`/equipes?result=${result}`);
}

async function authorizedUser(action: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getCommunityTeamsCommunityId(user.id);
  if (!communityId) redirect("/equipes?result=unavailable");
  if (!checkRateLimit(user.id, action)) done("rate");
  return { user, communityId };
}

export async function createCommunityTeamAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("createCommunityTeam");
  const input = communityTeamSchema.safeParse({
    gameId: formData.get("gameId"),
    name: formData.get("name"),
    description: formData.get("description"),
    platform: formData.get("platform"),
    maxMembers: formData.get("maxMembers"),
  });
  if (!input.success) done("invalid");
  done(await createCommunityTeam({ userId: user.id, communityId, ...input.data }));
}

export async function joinCommunityTeamAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("joinCommunityTeam");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  if (!teamId.success) done("invalid");
  done(await joinCommunityTeam(user.id, communityId, teamId.data));
}

export async function leaveCommunityTeamAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("leaveCommunityTeam");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  if (!teamId.success) done("invalid");
  done(await leaveCommunityTeam(user.id, communityId, teamId.data));
}

export async function setCommunityTeamRecruitmentAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("setCommunityTeamRecruitment");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  const open = formData.get("open");
  if (!teamId.success || (open !== "true" && open !== "false")) done("invalid");
  done(await setCommunityTeamRecruitment(user.id, communityId, teamId.data, open === "true"));
}
