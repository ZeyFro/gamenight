"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { GAMING_IDENTIFIER_FIELDS, gamingIdentifiersSchema } from "@/lib/gaming-identifiers";

export async function updateGamingIdentifiersAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updateGamingIdentifiers")) {
    redirect("/profil/parametres?identifiants=rate_limited");
  }
  const parsed = gamingIdentifiersSchema.safeParse(Object.fromEntries(
    GAMING_IDENTIFIER_FIELDS.map(({ key }) => [key, formData.get(key)])
  ));
  if (!parsed.success) redirect("/profil/parametres?identifiants=invalide");

  // L'identité vient exclusivement de la session serveur ; aucun userId ni
  // champ Steam envoyé par le formulaire n'entre dans la mise à jour.
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/profil/parametres");
  revalidatePath(`/potes/${user.id}`, "layout");
  redirect("/profil/parametres?identifiants=ok");
}
