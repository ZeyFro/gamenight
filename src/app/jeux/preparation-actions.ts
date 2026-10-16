"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { gamePreparationSchema } from "@/lib/game-preparation";
import { wallClockNow } from "@/lib/wallclock";

export async function updateGamePreparation(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updateGamePreparation")) return { ok: false, error: "rate_limited" } as const;
  const parsed = gamePreparationSchema.safeParse(Object.fromEntries(
    ["gameId", "preparationCost", "preparationPrice", "downloadSizeGb", "preparationPlatform", "preparationSourceUrl"].map(key => [key, form.get(key)]),
  ));
  if (!parsed.success) return { ok: false, error: "invalid" } as const;
  const { gameId, ...data } = parsed.data;
  const result = await prisma.game.updateMany({ where: { id: gameId, userGames: { some: { userId: user.id, owned: true } } }, data: { ...data, preparationUpdatedAt: wallClockNow() } });
  if (!result.count) return { ok: false, error: "access" } as const;
  revalidatePath(`/jeux/${encodeURIComponent(gameId)}`);
  return { ok: true } as const;
}
