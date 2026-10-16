"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { gameWarningsSchema } from "@/lib/game-warnings";
import { wallClockNow } from "@/lib/wallclock";

export async function updateGameWarnings(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updateGameWarnings")) return { ok: false, error: "rate_limited" } as const;
  const parsed = gameWarningsSchema.safeParse(Object.fromEntries(
    ["gameId", "jumpscares", "motionSickness", "textLanguages", "audioLanguages"].map(key => [key, form.get(key)]),
  ));
  if (!parsed.success) return { ok: false, error: "invalid" } as const;
  const { gameId, ...data } = parsed.data;
  // L'autorisation fait partie de l'écriture : owned:false et tiers refusés.
  const result = await prisma.game.updateMany({
    where: { id: gameId, userGames: { some: { userId: user.id, owned: true } } },
    data: { ...data, warningsUpdatedAt: wallClockNow() },
  });
  if (!result.count) return { ok: false, error: "access" } as const;
  revalidatePath(`/jeux/${encodeURIComponent(gameId)}`);
  revalidatePath("/sessions", "layout");
  revalidatePath("/jouer-maintenant", "layout");
  return { ok: true } as const;
}
