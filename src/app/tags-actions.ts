"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { tagNameSchema, idSchema } from "@/lib/validations";

/**
 * Tags perso (Sprint 3, FEATURE 6) — chaque pote s'attribue/se retire ses
 * propres tags depuis `/profil/parametres`, jamais ceux d'un autre user
 * (pas de `userId` pris depuis `formData`, toujours `getCurrentUser()`).
 */
export async function toggleUserTagAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "toggleUserTag")) return;

  const input = idSchema.safeParse(String(formData.get("tagId") ?? ""));
  if (!input.success) return;
  const tagId = input.data;

  const existing = await prisma.userTag.findUnique({
    where: { userId_tagId: { userId: user.id, tagId } },
  });

  if (existing) {
    await prisma.userTag.delete({ where: { userId_tagId: { userId: user.id, tagId } } });
  } else {
    // Le tag pourrait avoir été supprimé entre le rendu et le clic (rare,
    // pas de suppression de tag exposée pour l'instant, mais gardé
    // défensif) — la FK échouerait sinon avec une erreur non gérée.
    const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true } });
    if (!tag) return;
    await prisma.userTag.create({ data: { userId: user.id, tagId } });
  }

  revalidatePath("/profil/parametres");
}

/**
 * Création d'un nouveau tag libre + auto-attribution à son créateur —
 * n'importe quel pote peut en créer un (pas de rôle admin dédié, cf.
 * commentaire sur le modèle `Tag`). `Tag.name` étant `@unique`, un nom déjà
 * pris (casse near-identique acceptée telle quelle, pas de normalisation)
 * est simplement récupéré et attribué plutôt que de faire échouer l'action
 * — créer "FPS" alors qu'il existe déjà revient juste à se l'attribuer.
 */
export async function createTagAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "createTag")) return;

  const input = tagNameSchema.safeParse({ name: String(formData.get("name") ?? "") });
  if (!input.success) return;
  const { name } = input.data;

  const tag = await prisma.tag.upsert({
    where: { name },
    update: {},
    create: { name },
  });

  await prisma.userTag.upsert({
    where: { userId_tagId: { userId: user.id, tagId: tag.id } },
    update: {},
    create: { userId: user.id, tagId: tag.id },
  });

  revalidatePath("/profil/parametres");
}
