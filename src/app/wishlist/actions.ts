"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { wallClockNow } from "@/lib/wallclock";
import {
  proposeWishlistGameSchema,
  voteWishlistSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";

/**
 * Propose un jeu à la wishlist — `@@unique([gameId])` empêche les
 * doublons (un jeu déjà présent redirige simplement vers sa carte
 * existante plutôt que d'échouer, cf. `catch` ci-dessous). Si un membre
 * du groupe possède déjà ce jeu (import Steam antérieur à la
 * proposition — le check normal, `checkWishlistPurchases`, ne tourne
 * qu'aux imports SUIVANTS), l'entrée est immédiatement marquée achetée.
 */
export async function proposeWishlistGameAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "proposeWishlistGame")) {
    redirect(`/wishlist?error=${VALIDATION_ERROR_KEY}`);
  }

  const input = proposeWishlistGameSchema.safeParse({
    gameId: String(formData.get("gameId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!input.success) redirect(`/wishlist?error=${VALIDATION_ERROR_KEY}`);
  const { gameId, reason } = input.data;

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) redirect(`/wishlist?error=${VALIDATION_ERROR_KEY}`);

  const existingOwner = await prisma.userGame.findFirst({
    where: { gameId, owned: true },
    select: { userId: true },
  });

  try {
    await prisma.gameWishlist.create({
      data: {
        gameId,
        proposedById: user.id,
        reason: reason || null,
        purchasedById: existingOwner?.userId ?? null,
        purchasedAt: existingOwner ? wallClockNow() : null,
      },
    });
  } catch {
    // Contrainte unique (déjà proposé) : on ignore, la carte existe déjà.
  }

  revalidatePath("/wishlist");
  redirect("/wishlist");
}

/** Vote "Intéressé 👍" / "Pas pour moi 👎" — revote = remplace le vote existant (upsert). */
export async function voteWishlistAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "voteWishlist")) return;

  const input = voteWishlistSchema.safeParse({
    wishlistId: String(formData.get("wishlistId") ?? ""),
    interested: String(formData.get("interested") ?? ""),
  });
  if (!input.success) return;
  const { wishlistId, interested } = input.data;

  const wishlist = await prisma.gameWishlist.findUnique({
    where: { id: wishlistId },
    select: { id: true },
  });
  if (!wishlist) return;

  await prisma.gameWishlistVote.upsert({
    where: { wishlistId_userId: { wishlistId, userId: user.id } },
    create: { wishlistId, userId: user.id, interested: interested === "true" },
    update: { interested: interested === "true" },
  });

  revalidatePath("/wishlist");
}
