"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { creationKey } from "@/lib/creation-intent";
import { logger } from "@/lib/logger";
import { createCommunityQuickPoll, voteCommunityQuickPoll } from "@/lib/community-quick-polls";
import { isCommunityQuickPollsEnabled } from "@/lib/community-quick-polls-input";

const PATH = "/profil/lore/sondages";

export async function createCommunityQuickPollAction(formData: FormData): Promise<void> {
  if (!isCommunityQuickPollsEnabled()) redirect("/profil/lore");
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "createCommunityQuickPoll", { limit: 5 })) redirect(`${PATH}?result=rate`);
  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || !communityId || communityId.length > 100) redirect(`${PATH}?result=invalid`);
  const options = formData.get("options");
  let result: string;
  try {
    result = await createCommunityQuickPoll(user.id, {
      question: formData.get("question"), options: typeof options === "string" ? options.split(/\r?\n/) : options, durationMinutes: formData.get("durationMinutes"),
    }, communityId, creationKey(formData.get("creationKey"), true));
  } catch (error) {
    logger.error("community-quick-poll-create", error, { userId: user.id });
    redirect(`${PATH}?result=invalid`);
  }
  if (result === "saved") revalidatePath(PATH);
  redirect(`${PATH}?result=${result}`);
}

export async function voteCommunityQuickPollAction(formData: FormData): Promise<void> {
  if (!isCommunityQuickPollsEnabled()) redirect("/profil/lore");
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "voteCommunityQuickPoll", { limit: 30 })) redirect(`${PATH}?result=rate`);
  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || !communityId || communityId.length > 100) redirect(`${PATH}?result=invalid`);
  let result: string;
  try {
    result = await voteCommunityQuickPoll(user.id, formData.get("pollId"), formData.get("optionIndex"), communityId);
  } catch (error) {
    logger.error("community-quick-poll-vote", error, { userId: user.id });
    redirect(`${PATH}?result=unavailable`);
  }
  if (result === "saved") revalidatePath(PATH);
  redirect(`${PATH}?result=${result}`);
}
