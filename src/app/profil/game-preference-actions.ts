"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { gamePreferencesSchema } from "@/lib/game-preferences";
import { gamePreferenceMemberWhere } from "@/lib/game-suggestions";

export async function updateGamePreferencesAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updateGamePreferences")) redirect("/profil/parametres?gouts=rate_limited");
  const parsed = gamePreferencesSchema.safeParse({ preferredGameCategories: form.getAll("preferredGameCategories"), refusedGameCategories: form.getAll("refusedGameCategories") });
  if (!parsed.success) redirect("/profil/parametres?gouts=invalide");
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/profil/parametres"); revalidatePath("/bibliotheque/suggestions");
  redirect("/profil/parametres?gouts=ok");
}
export async function setGameRefusalAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "setGameRefusal")) redirect("/profil/parametres?gouts=rate_limited");
  const parsed = z.object({ gameId: z.string().min(1).max(100), mode: z.enum(["refuse", "remove"]) }).safeParse({ gameId: form.get("gameId"), mode: form.get("mode") });
  if (!parsed.success) redirect("/profil/parametres?gouts=invalide");
  const { gameId, mode } = parsed.data;
  if (mode === "remove") {
    await prisma.userGameRefusal.deleteMany({ where: { userId: user.id, gameId } });
  } else {
    const visible = await prisma.game.findFirst({ where: { id: gameId, userGames: { some: { owned: true, user: await gamePreferenceMemberWhere(user.id) } } }, select: { id: true } });
    if (!visible) redirect("/profil/parametres?gouts=inaccessible");
    await prisma.userGameRefusal.createMany({ data: [{ userId: user.id, gameId }], skipDuplicates: true });
  }
  revalidatePath("/profil/parametres"); revalidatePath("/bibliotheque/suggestions");
  redirect("/profil/parametres?gouts=ok");
}
