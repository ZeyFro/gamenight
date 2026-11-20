"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import {
  answerChallengeResult,
  cancelChallenge,
  getRivalriesCommunityId,
  proposeChallenge,
  reportChallengeResult,
  respondToChallenge,
} from "@/lib/team-rivalries";

function back(teamId: string, result: string): never {
  const path = `/equipes/${teamId}/rivalites`;
  revalidatePath(path);
  redirect(`${path}?result=${result}`);
}

async function authorized(action: string, teamId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getRivalriesCommunityId(user.id);
  if (!communityId) redirect("/equipes");
  if (!checkRateLimit(user.id, action)) back(teamId, "rate");
  return { user, communityId };
}

function teamIdOf(formData: FormData): string {
  const parsed = idSchema.safeParse(formData.get("teamId"));
  if (!parsed.success) redirect("/equipes");
  return parsed.data;
}

export async function proposeChallengeAction(formData: FormData): Promise<void> {
  const teamId = teamIdOf(formData);
  const { user, communityId } = await authorized("proposeTeamChallenge", teamId);
  const result = await proposeChallenge(user.id, communityId, {
    challengerTeamId: teamId, opponentTeamId: formData.get("opponentTeamId"), gameName: formData.get("gameName") ?? undefined, message: formData.get("message") ?? undefined,
  });
  back(teamId, result.ok ? "proposed" : result.reason);
}

export async function respondToChallengeAction(formData: FormData): Promise<void> {
  const teamId = teamIdOf(formData);
  const { user, communityId } = await authorized("respondTeamChallenge", teamId);
  const challengeId = idSchema.safeParse(formData.get("challengeId"));
  if (!challengeId.success) back(teamId, "invalid");
  const decision = String(formData.get("decision")) === "ACCEPT" ? "ACCEPT" : "DECLINE";
  const result = await respondToChallenge(user.id, communityId, challengeId.data, decision);
  back(teamId, result.ok ? (decision === "ACCEPT" ? "accepted" : "declined") : result.reason);
}

export async function cancelChallengeAction(formData: FormData): Promise<void> {
  const teamId = teamIdOf(formData);
  const { user, communityId } = await authorized("cancelTeamChallenge", teamId);
  const challengeId = idSchema.safeParse(formData.get("challengeId"));
  if (!challengeId.success) back(teamId, "invalid");
  const result = await cancelChallenge(user.id, communityId, challengeId.data);
  back(teamId, result.ok ? "cancelled" : result.reason);
}

export async function reportChallengeResultAction(formData: FormData): Promise<void> {
  const teamId = teamIdOf(formData);
  const { user, communityId } = await authorized("reportTeamChallenge", teamId);
  const challengeId = idSchema.safeParse(formData.get("challengeId"));
  if (!challengeId.success) back(teamId, "invalid");
  const result = await reportChallengeResult(user.id, communityId, challengeId.data, formData.get("outcome"));
  back(teamId, result.ok ? "reported" : result.reason);
}

export async function answerChallengeResultAction(formData: FormData): Promise<void> {
  const teamId = teamIdOf(formData);
  const { user, communityId } = await authorized("answerTeamChallenge", teamId);
  const challengeId = idSchema.safeParse(formData.get("challengeId"));
  if (!challengeId.success) back(teamId, "invalid");
  const answer = String(formData.get("answer")) === "CONFIRM" ? "CONFIRM" : "DISPUTE";
  const result = await answerChallengeResult(user.id, communityId, challengeId.data, answer);
  back(teamId, result.ok ? (answer === "CONFIRM" ? "confirmed" : "disputed") : result.reason);
}
