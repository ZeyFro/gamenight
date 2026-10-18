"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { submitTournamentPrediction } from "@/lib/tournament-predictions";

export async function submitTournamentPredictionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const tournament = idSchema.safeParse(formData.get("tournamentId"));
  const target = idSchema.safeParse(formData.get("target"));
  const predicted = idSchema.safeParse(formData.get("predictedUserId"));
  if (!tournament.success || !target.success || !predicted.success) return;
  const path = `/tournois/${tournament.data}`;
  if (!checkRateLimit(user.id, "tournamentPrediction")) redirect(`${path}?error=rate_limited`);
  const saved = await submitTournamentPrediction(user.id, tournament.data, target.data, predicted.data);
  if (!saved) redirect(`${path}?error=prediction`);
  revalidatePath(path);
}
