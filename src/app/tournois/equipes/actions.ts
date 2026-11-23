"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { TOURNAMENT_QUOTA_ERROR_KEY } from "@/lib/creation-quota";
import { idSchema } from "@/lib/validations";
import { parsePlayerClassifiedDateTime } from "@/lib/player-classifieds-rules";
import { createTeamTournamentSchema, matchReportSchema, teamEntrySchema } from "@/lib/tournament-teams-rules";
import {
  createTeamTournament, enterTeamInTournament, getTournamentTeamsCommunityId, inviteTeamToTournament, launchTeamTournament,
  leaveTeamTournament, resolveMatchByReferee, submitMatchReport,
} from "@/lib/tournament-teams";

const LIST = "/tournois/equipes";

function done(result: string, tournamentId?: string): never {
  revalidatePath(LIST);
  if (tournamentId) revalidatePath(`${LIST}/${tournamentId}`);
  redirect(`${tournamentId ? `${LIST}/${tournamentId}` : LIST}?result=${result}`);
}

async function authorizedUser(action: string, tournamentId?: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTournamentTeamsCommunityId(user.id);
  if (!communityId) redirect(`${LIST}?result=unavailable`);
  if (!checkRateLimit(user.id, action)) done("rate", tournamentId);
  return { user, communityId };
}

export async function createTeamTournamentAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorizedUser("createTeamTournament");
  const date = String(formData.get("closesDate") ?? "");
  const time = String(formData.get("closesTime") ?? "");
  if (Boolean(date) !== Boolean(time)) done("invalid");
  const closesAt = date && time ? parsePlayerClassifiedDateTime(date, time) : null;
  if (date && !closesAt) done("invalid");
  const input = createTeamTournamentSchema.safeParse({
    name: formData.get("name"), gameId: formData.get("gameId"), maxTeams: formData.get("maxTeams"),
    isPrivate: formData.get("isPrivate") === "on", registrationClosesAt: closesAt,
  });
  if (!input.success) done("invalid");
  const result = await createTeamTournament(user.id, communityId, input.data);
  if (result.result === "created") done("created", result.tournamentId);
  if (result.result === "daily_limit") done(TOURNAMENT_QUOTA_ERROR_KEY);
  done(result.result);
}

export async function enterTeamAction(formData: FormData): Promise<void> {
  const input = teamEntrySchema.safeParse({ tournamentId: formData.get("tournamentId"), teamId: formData.get("teamId") });
  const { user, communityId } = await authorizedUser("enterTeamTournament", input.success ? input.data.tournamentId : undefined);
  if (!input.success) done("invalid");
  done(`entry_${await enterTeamInTournament(user.id, communityId, input.data)}`, input.data.tournamentId);
}

export async function leaveTeamAction(formData: FormData): Promise<void> {
  const input = teamEntrySchema.safeParse({ tournamentId: formData.get("tournamentId"), teamId: formData.get("teamId") });
  const { user, communityId } = await authorizedUser("leaveTeamTournament", input.success ? input.data.tournamentId : undefined);
  if (!input.success) done("invalid");
  done(`leave_${await leaveTeamTournament(user.id, communityId, input.data)}`, input.data.tournamentId);
}

export async function inviteTeamAction(formData: FormData): Promise<void> {
  const input = teamEntrySchema.safeParse({ tournamentId: formData.get("tournamentId"), teamId: formData.get("teamId") });
  const { user, communityId } = await authorizedUser("inviteTeamTournament", input.success ? input.data.tournamentId : undefined);
  if (!input.success) done("invalid");
  done(`invite_${await inviteTeamToTournament(user.id, communityId, input.data)}`, input.data.tournamentId);
}

export async function launchTeamTournamentAction(formData: FormData): Promise<void> {
  const tournamentId = idSchema.safeParse(formData.get("tournamentId"));
  const { user, communityId } = await authorizedUser("launchTeamTournament", tournamentId.success ? tournamentId.data : undefined);
  if (!tournamentId.success) done("invalid");
  done(`launch_${await launchTeamTournament(user.id, communityId, tournamentId.data)}`, tournamentId.data);
}

export async function reportMatchAction(formData: FormData): Promise<void> {
  const tournamentId = idSchema.safeParse(formData.get("tournamentId"));
  const { user, communityId } = await authorizedUser("reportTeamMatch", tournamentId.success ? tournamentId.data : undefined);
  const input = matchReportSchema.safeParse({
    matchId: formData.get("matchId"), winnerTeamId: formData.get("winnerTeamId"), score1: formData.get("score1"), score2: formData.get("score2"),
  });
  if (!tournamentId.success || !input.success) done("invalid", tournamentId.success ? tournamentId.data : undefined);
  done(`report_${await submitMatchReport(user.id, communityId, input.data)}`, tournamentId.data);
}

export async function resolveMatchAction(formData: FormData): Promise<void> {
  const tournamentId = idSchema.safeParse(formData.get("tournamentId"));
  const { user, communityId } = await authorizedUser("resolveTeamMatch", tournamentId.success ? tournamentId.data : undefined);
  const input = matchReportSchema.safeParse({
    matchId: formData.get("matchId"), winnerTeamId: formData.get("winnerTeamId"), score1: formData.get("score1"), score2: formData.get("score2"),
  });
  if (!tournamentId.success || !input.success) done("invalid", tournamentId.success ? tournamentId.data : undefined);
  done(`resolve_${await resolveMatchByReferee(user.id, communityId, input.data)}`, tournamentId.data);
}
