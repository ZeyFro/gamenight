"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPlayerMatchingEnabled, playerMatchingSchema } from "@/lib/player-matching-rules";

export async function updatePlayerMatchingAction(formData: FormData) {
  if (!isPlayerMatchingEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updatePlayerMatching")) redirect("/profil/parametres?habitudes=rate_limited");
  const parsed = playerMatchingSchema.safeParse({
    languages: formData.getAll("languages"),
    playHabits: formData.getAll("playHabits"),
    communityPreferences: formData.getAll("communityPreferences"),
  });
  if (!parsed.success) redirect("/profil/parametres?habitudes=invalide");
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/profil/parametres");
  revalidatePath("/potes");
  revalidatePath(`/potes/${user.id}`, "layout");
  redirect("/profil/parametres?habitudes=ok");
}
