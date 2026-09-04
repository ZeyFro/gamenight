"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { wallClockNow } from "@/lib/wallclock";
import {
  proposeWishlistGameSchema,
  voteWishlistSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";
import { RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";

/** Même contrat que `ToggleVoteResult` (src/app/sessions/actions.ts) — mise à jour optimiste côté client, défaite si `ok: false`. */
export interface VoteWishlistResult {
  ok: boolean;
  error?: string;
}

/**
 * Fix (Sprint 5 suite) — propose un jeu à la wishlist depuis un résultat
 * de recherche IGDB (le but est de pouvoir proposer un jeu que PERSONNE
 * ne possède encore, ex. un jeu pas encore sorti — un simple select sur
 * la biblio du groupe ne le permettait pas). Upsert par `igdbId`, même
 * logique que `addManualGame` (src/app/actions.ts) : si le jeu existe
 * déjà en base (import Steam matché, ajout manuel antérieur…), on
 * l'attache directement plutôt que de dupliquer la ligne `Game`.
 *
 * `@@unique([gameId])` sur `GameWishlist` empêche les doublons de
 * proposition (un jeu déjà présent redirige simplement vers sa carte
 * existante plutôt que d'échouer, cf. `catch` ci-dessous). Si un membre
 * du groupe possède déjà ce jeu, l'entrée est immédiatement marquée
 * achetée (le check normal, `checkWishlistPurchases`, ne tourne qu'aux
 * imports Steam SUIVANTS).
 */
export async function proposeWishlistGameAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "proposeWishlistGame")) {
    redirect(`/wishlist?error=${VALIDATION_ERROR_KEY}`);
  }

  const input = proposeWishlistGameSchema.safeParse({
    igdbId: String(formData.get("igdbId") ?? ""),
    name: String(formData.get("name") ?? ""),
    coverUrl: String(formData.get("coverUrl") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!input.success) redirect(`/wishlist?error=${VALIDATION_ERROR_KEY}`);
  const { name, coverUrl, reason } = input.data;
  const igdbId = Number(input.data.igdbId);

  const game = await prisma.game.upsert({
    where: { igdbId },
    update: {},
    create: {
      name,
      coverUrl: coverUrl || null,
      source: GameSource.IGDB,
      igdbId,
      minPlayers: 2,
      addedById: user.id,
    },
  });

  const existingOwner = await prisma.userGame.findFirst({
    where: { gameId: game.id, owned: true },
    select: { userId: true },
  });

  try {
    await prisma.gameWishlist.create({
      data: {
        gameId: game.id,
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

/**
 * Vote "Intéressé 👍" / "Pas pour moi 👎" — revote = remplace le vote
 * existant (upsert). Renvoie un résultat (Sprint 5 suite, I2) : le bouton
 * fait une mise à jour optimiste avant d'appeler cette action, elle doit
 * pouvoir la défaire si la requête est refusée (même pattern que
 * `toggleVote`/`VoteButton`).
 */
export async function voteWishlistAction(formData: FormData): Promise<VoteWishlistResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "voteWishlist")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const input = voteWishlistSchema.safeParse({
    wishlistId: String(formData.get("wishlistId") ?? ""),
    interested: String(formData.get("interested") ?? ""),
  });
  if (!input.success) return { ok: true };
  const { wishlistId, interested } = input.data;

  const wishlist = await prisma.gameWishlist.findUnique({
    where: { id: wishlistId },
    select: { id: true },
  });
  if (!wishlist) return { ok: true };

  await prisma.gameWishlistVote.upsert({
    where: { wishlistId_userId: { wishlistId, userId: user.id } },
    create: { wishlistId, userId: user.id, interested: interested === "true" },
    update: { interested: interested === "true" },
  });

  revalidatePath("/wishlist");
  return { ok: true };
}
