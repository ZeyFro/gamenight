"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { creationKey } from "@/lib/creation-intent";
import { resumeCreation } from "@/lib/creation-resume";
import { logger } from "@/lib/logger";
import { AvailabilityPollError } from "@/lib/session-availability-poll-data";
import {
  answerAvailabilityPoll,
  chooseAvailabilityPollSlot,
  closeAvailabilityPoll,
  createAvailabilityPoll,
} from "@/lib/session-availability-poll-data";

function values(formData: FormData, key: string) {
  return formData.getAll(key).filter((value): value is string => typeof value === "string");
}

export async function createAvailabilityPollAction(formData: FormData) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/sessions/sondages/nouveau?error=authentication");
  const resumed = await resumeCreation(user.id, "AVAILABILITY_POLL", formData);
  if (resumed) redirect(resumed);
  if (!checkRateLimit(user.id, "createAvailabilityPoll", { limit: 5 })) redirect("/sessions/sondages/nouveau?error=rate_limited");
  const dates = values(formData, "optionDate");
  const times = values(formData, "optionTime");
  const durations = values(formData, "optionDuration");
  if (dates.length !== times.length || dates.length !== durations.length) redirect("/sessions/sondages/nouveau?error=invalid");
  const rawDuration = (value: string) => value === "60" ? 60 : value === "90" ? 90 : value === "120" ? 120 : value === "180" ? 180 : 0;
  let poll: { id: string };
  try {
    poll = await createAvailabilityPoll(user.id, {
      title: formData.get("title"),
      participantIds: [...values(formData, "participantId"), user.id],
      options: dates.map((date, index) => ({ date, time: times[index], durationMinutes: rawDuration(durations[index]) })),
    }, creationKey(formData.get("creationKey"), true));
  } catch (error) {
    if (!(error instanceof AvailabilityPollError)) logger.error("availability-poll-create", error, { userId: user.id });
    redirect("/sessions/sondages/nouveau?error=invalid");
  }
  redirect(`/sessions/sondages/${poll.id}`);
}

export async function answerAvailabilityPollAction(formData: FormData) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const pollId = String(formData.get("pollId") ?? "");
  const slotId = String(formData.get("slotId") ?? "");
  const answer = String(formData.get("answer") ?? "");
  if (!checkRateLimit(user.id, "answerAvailabilityPoll", { limit: 30 })) redirect(`/sessions/sondages/${pollId}?error=rate_limited`);
  try {
    await answerAvailabilityPoll(user.id, pollId, slotId, answer === "CLEAR" ? null : answer);
    revalidatePath(`/sessions/sondages/${pollId}`);
    revalidatePath("/sessions/sondages");
  } catch (error) {
    if (!(error instanceof AvailabilityPollError)) logger.error("availability-poll-answer", error, { userId: user.id, pollId });
    redirect(`/sessions/sondages/${pollId}?error=save_failed`);
  }
  redirect(`/sessions/sondages/${pollId}`);
}

export async function closeAvailabilityPollAction(formData: FormData) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const pollId = String(formData.get("pollId") ?? "");
  try { await closeAvailabilityPoll(user.id, pollId); }
  catch (error) {
    if (!(error instanceof AvailabilityPollError)) logger.error("availability-poll-close", error, { userId: user.id, pollId });
    redirect(`/sessions/sondages/${pollId}?error=close_failed`);
  }
  revalidatePath(`/sessions/sondages/${pollId}`);
  revalidatePath("/sessions/sondages");
  redirect(`/sessions/sondages/${pollId}`);
}

export async function chooseAvailabilityPollSlotAction(formData: FormData) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const pollId = String(formData.get("pollId") ?? "");
  const slotId = String(formData.get("slotId") ?? "");
  if (!checkRateLimit(user.id, "chooseAvailabilityPollSlot", { limit: 5 })) redirect(`/sessions/sondages/${pollId}?error=rate_limited`);
  try {
    const { session } = await chooseAvailabilityPollSlot(user.id, pollId, slotId);
    await awardXp(user.id, session.communityId, "CREATE_SESSION", session.id, XP_AMOUNTS.CREATE_SESSION);
    await checkSessionsCreatedBadges(user.id, session.communityId);
    revalidatePath("/sessions");
    revalidatePath("/sessions/sondages");
    redirect(`/sessions/${session.id}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
    if (!(error instanceof AvailabilityPollError)) logger.error("availability-poll-choose", error, { userId: user.id, pollId });
    redirect(`/sessions/sondages/${pollId}?error=unavailable`);
  }
}
