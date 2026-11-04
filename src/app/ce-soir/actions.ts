"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPlayerClassifiedCommunityId } from "@/lib/player-classifieds";
import {
  TONIGHT_MESSAGE_PREFIX,
  buildTonightMessage,
  isTonightEnabled,
  parseTonightForm,
  tonightExpiresAt,
} from "@/lib/tonight-rules";
import { wallClockNow } from "@/lib/wallclock";

/**
 * « Je suis dispo ce soir » en un clic : remplace les déclarations du soir
 * de l'utilisateur par une petite annonce par jeu choisi (1 à 3), qui
 * expire à 4 h du matin. Aucune notification Discord.
 */
export async function declareTonightAction(formData: FormData): Promise<void> {
  if (!isTonightEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) redirect("/ce-soir?error=unavailable");
  if (!checkRateLimit(user.id, "declareTonight")) redirect("/ce-soir?error=rate_limited");

  const input = parseTonightForm(formData);
  if (!input.success) redirect("/ce-soir?error=invalid");
  const scopedDb = await getScopedPrisma(user.id);
  const games = await scopedDb.game.findMany({ where: { id: { in: input.data.gameIds } }, select: { id: true } });
  if (games.length !== input.data.gameIds.length) redirect("/ce-soir?error=invalid");

  const createdAt = wallClockNow();
  const message = buildTonightMessage(input.data.note);
  const expiresAt = tonightExpiresAt(createdAt);
  // Remplacement atomique : si la création échoue, les anciennes disponibilités
  // restent présentes. Le client transactionnel garde le périmètre communautaire.
  await prisma.$transaction(async (tx) => {
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    await scopedDb.playerClassified.deleteMany({
      where: { communityId, createdById: user.id, message: { startsWith: TONIGHT_MESSAGE_PREFIX } },
    });
    await scopedDb.playerClassified.createMany({
      data: input.data.gameIds.map((gameId) => ({
        communityId,
        gameId,
        createdById: user.id,
        message,
        createdAt,
        expiresAt,
      })),
    });
  });
  revalidatePath("/ce-soir");
  revalidatePath("/joueurs");
  redirect("/ce-soir?declared=1");
}

/** « Je ne suis plus dispo » : retire uniquement les déclarations du soir de l'utilisateur. */
export async function clearTonightAction(): Promise<void> {
  if (!isTonightEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) redirect("/ce-soir?error=unavailable");
  if (!checkRateLimit(user.id, "clearTonight")) redirect("/ce-soir?error=rate_limited");

  const scopedDb = await getScopedPrisma(user.id);
  await scopedDb.playerClassified.deleteMany({
    where: { communityId, createdById: user.id, message: { startsWith: TONIGHT_MESSAGE_PREFIX } },
  });
  revalidatePath("/ce-soir");
  revalidatePath("/joueurs");
  redirect("/ce-soir");
}
