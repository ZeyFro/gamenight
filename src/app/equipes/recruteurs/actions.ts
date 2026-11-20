"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { teamGuestInviteSchema, teamRecruiterSchema } from "@/lib/team-recruiters-rules";
import {
  addTeamRecruiter, getTeamRecruitersCommunityId, inviteTeamGuest, removeTeamRecruiter, respondToTeamGuestInvitation, revokeTeamGuest,
} from "@/lib/team-recruiters";

function done(result: string, path = "/equipes/gestion"): never {
  revalidatePath("/equipes/gestion");
  revalidatePath("/equipes/candidatures");
  redirect(`${path}?result=${result}`);
}

async function authorizedUser(action: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTeamRecruitersCommunityId(user.id);
  if (!communityId) redirect("/equipes/gestion?result=unavailable");
  if (!checkRateLimit(user.id, action)) done("rate");
  return { user, communityId };
}

export async function addTeamRecruiterAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("addTeamRecruiter");
  const input = teamRecruiterSchema.safeParse({ teamId: formData.get("teamId"), userId: formData.get("userId") });
  if (!input.success) done("invalid");
  done(`recruiter_${await addTeamRecruiter(user.id, communityId, input.data)}`);
}

export async function removeTeamRecruiterAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("removeTeamRecruiter");
  const input = teamRecruiterSchema.safeParse({ teamId: formData.get("teamId"), userId: formData.get("userId") });
  if (!input.success) done("invalid");
  done(`recruiter_${await removeTeamRecruiter(user.id, communityId, input.data)}`);
}

export async function inviteTeamGuestAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("inviteTeamGuest");
  const input = teamGuestInviteSchema.safeParse({ teamId: formData.get("teamId"), tournamentId: formData.get("tournamentId"), userId: formData.get("userId") });
  if (!input.success) done("invalid");
  done(`guest_${await inviteTeamGuest(user.id, communityId, input.data)}`);
}

export async function revokeTeamGuestAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("revokeTeamGuest");
  const guestId = idSchema.safeParse(formData.get("guestId"));
  if (!guestId.success) done("invalid");
  done(`guest_${await revokeTeamGuest(user.id, communityId, guestId.data)}`);
}

export async function respondTeamGuestAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("respondTeamGuest");
  const guestId = idSchema.safeParse(formData.get("guestId"));
  const decision = formData.get("decision");
  if (!guestId.success || (decision !== "accept" && decision !== "decline")) done("invalid");
  done(`guest_${await respondToTeamGuestInvitation(user.id, communityId, guestId.data, decision === "accept")}`, "/equipes/candidatures");
}
