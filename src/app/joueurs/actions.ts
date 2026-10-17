"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { getPlayerClassifiedCommunityId, playerClassifiedExpiresAt, playerClassifiedSchema } from "@/lib/player-classifieds";
import { wallClockNow } from "@/lib/wallclock";
import { requireAdmin } from "@/lib/admin";

export async function createPlayerClassifiedAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) redirect("/joueurs?error=unavailable");
  if (!checkRateLimit(user.id, "createPlayerClassified")) redirect("/joueurs?error=rate_limited");

  const input = playerClassifiedSchema.safeParse({
    gameId: formData.get("gameId"),
    message: formData.get("message"),
  });
  if (!input.success) redirect("/joueurs?error=invalid");
  const scopedDb = await getScopedPrisma(user.id);
  const game = await scopedDb.game.findUnique({ where: { id: input.data.gameId }, select: { id: true } });
  if (!game) redirect("/joueurs?error=invalid");

  const createdAt = wallClockNow();
  await scopedDb.playerClassified.create({
    data: {
      communityId,
      gameId: game.id,
      createdById: user.id,
      message: input.data.message,
      createdAt,
      expiresAt: playerClassifiedExpiresAt(createdAt),
    },
  });
  revalidatePath("/joueurs");
  redirect("/joueurs");
}

export async function deletePlayerClassifiedAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) redirect("/joueurs?error=unavailable");
  if (!checkRateLimit(user.id, "deletePlayerClassified")) redirect("/joueurs?error=rate_limited");
  const parsed = idSchema.safeParse(formData.get("id"));
  if (!parsed.success) redirect("/joueurs?error=invalid");

  const scopedDb = await getScopedPrisma(user.id);
  const listing = await scopedDb.playerClassified.findFirst({
    where: { id: parsed.data, communityId },
    select: { id: true, createdById: true },
  });
  if (!listing || (listing.createdById !== user.id && !(await requireAdmin()))) {
    redirect("/joueurs?error=forbidden");
  }
  await scopedDb.playerClassified.deleteMany({ where: { id: listing.id, communityId } });
  revalidatePath("/joueurs");
}
