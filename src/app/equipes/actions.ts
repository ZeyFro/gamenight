"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCommunityTeamsCommunityId, createCommunityTeam, joinCommunityTeam, leaveCommunityTeam, setCommunityTeamRecruitment, transferCommunityTeamCaptain, dissolveCommunityTeam } from "@/lib/community-teams";
import { communityTeamSchema } from "@/lib/community-teams-rules";
import { idSchema } from "@/lib/validations";
import { getTeamRecruitmentCriteriaCommunityId, saveTeamRecruitmentCriteria } from "@/lib/team-recruitment-criteria";
import { parseTeamRecruitmentCriteriaForm } from "@/lib/team-recruitment-criteria-rules";
import {
  listTeamMemberDiscordIds,
  requestTeamSpaceAfterDissolution,
  requestTeamSpaceMemberSync,
  requestTeamSpaceProvisionForCreator,
} from "@/lib/discord-team-space-hooks";

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
  const result = await createCommunityTeam({ userId: user.id, communityId, ...input.data });
  // Option A : une équipe créée et admissible demande tout de suite ses deux
  // salons permanents (texte + vocal). No-op sans `DISCORD_TEAM_SPACES_ENABLED`.
  if (result === "created") await requestTeamSpaceProvisionForCreator({ communityId, userId: user.id });
  done(result);
}

export async function joinCommunityTeamAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("joinCommunityTeam");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  if (!teamId.success) done("invalid");
  const result = await joinCommunityTeam(user.id, communityId, teamId.data);
  if (result === "joined") await requestTeamSpaceMemberSync({ communityId, teamId: teamId.data, discordId: user.discordId });
  done(result);
}

export async function leaveCommunityTeamAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("leaveCommunityTeam");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  if (!teamId.success) done("invalid");
  const result = await leaveCommunityTeam(user.id, communityId, teamId.data);
  if (result === "left") await requestTeamSpaceMemberSync({ communityId, teamId: teamId.data, discordId: user.discordId });
  done(result);
}

export async function setCommunityTeamRecruitmentAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("setCommunityTeamRecruitment");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  const open = formData.get("open");
  if (!teamId.success || (open !== "true" && open !== "false")) done("invalid");
  done(await setCommunityTeamRecruitment(user.id, communityId, teamId.data, open === "true"));
}

function doneManagement(result: string): never {
  revalidatePath("/equipes");
  revalidatePath("/equipes/gestion");
  redirect(`/equipes/gestion?result=${result}`);
}

export async function transferCommunityTeamCaptainAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("transferCommunityTeamCaptain");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  const successorId = idSchema.safeParse(formData.get("successorId"));
  if (!teamId.success || !successorId.success) done("invalid");
  doneManagement(await transferCommunityTeamCaptain(user.id, communityId, teamId.data, successorId.data));
}

export async function saveTeamRecruitmentCriteriaAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTeamRecruitmentCriteriaCommunityId(user.id);
  if (!communityId) doneManagement("unavailable");
  if (!checkRateLimit(user.id, "saveTeamRecruitmentCriteria")) doneManagement("rate");
  const input = parseTeamRecruitmentCriteriaForm(formData);
  if (!input.success) doneManagement("invalid");
  doneManagement(await saveTeamRecruitmentCriteria(user.id, communityId, input.data));
}

export async function dissolveCommunityTeamAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("dissolveCommunityTeam");
  const teamId = idSchema.safeParse(formData.get("teamId"));
  if (!teamId.success || formData.get("confirm") !== "DISSOLVE") done("invalid");
  const formerMemberDiscordIds = await listTeamMemberDiscordIds(communityId, teamId.data);
  const result = await dissolveCommunityTeam(user.id, communityId, teamId.data);
  if (result === "dissolved") await requestTeamSpaceAfterDissolution({ communityId, teamId: teamId.data, formerMemberDiscordIds });
  doneManagement(result);
}
