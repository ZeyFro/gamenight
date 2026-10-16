"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { checkRateLimit } from "@/lib/rate-limit";

const axes = ["tryharder", "ambianceur", "stratege", "chaos"] as const;

export async function saveGameStyleProfile(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "saveGameStyleProfile")) redirect("/profil/parametres?style=rate_limited");
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) redirect("/profil/parametres?style=community");
  const rawScores = Object.fromEntries(axes.map((axis) => [axis, formData.get(axis)]));
  if (axes.some((axis) => typeof rawScores[axis] !== "string" || !/^[0-5]$/.test(rawScores[axis]))) {
    redirect("/profil/parametres?style=invalide");
  }
  const scores = Object.fromEntries(axes.map((axis) => [axis, Number(rawScores[axis])])) as Record<(typeof axes)[number], number>;
  await prisma.gameStyleProfile.upsert({
    where: { communityId_userId: { communityId, userId: user.id } },
    create: { communityId, userId: user.id, ...scores },
    update: scores,
  });
  revalidatePath("/profil/parametres");
  revalidatePath("/roulette");
  redirect("/profil/parametres?style=ok");
}
