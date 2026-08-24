"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Tier } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

const TIERS: Tier[] = ["S", "A", "B", "C", "D"];

/**
 * Appelée depuis `TierlistBoard` (drag & drop, pas un `<form>`) à chaque
 * dépose. `tier` absent/vide = retour en "Non classé" → suppression de la
 * ligne plutôt qu'une 6e valeur d'enum (voir le commentaire sur
 * `TierlistEntry` dans schema.prisma).
 */
export async function setGameTierAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) return;

  const tierRaw = String(formData.get("tier") ?? "");
  if (!tierRaw) {
    await prisma.tierlistEntry.deleteMany({ where: { userId: user.id, gameId } });
    revalidatePath("/tierlist");
    return;
  }
  if (!TIERS.includes(tierRaw as Tier)) return;
  const tier = tierRaw as Tier;

  await prisma.tierlistEntry.upsert({
    where: { userId_gameId: { userId: user.id, gameId } },
    create: { userId: user.id, gameId, tier },
    update: { tier },
  });

  revalidatePath("/tierlist");
}
