"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

/** Bouton "🔕 Couper les rappels" du profil (F7) : ne touche qu'aux pings, pas à l'envoi du message. */
export async function toggleSilenceReminders() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  await prisma.user.update({
    where: { id: user.id },
    data: { silenceReminders: !user.silenceReminders },
  });

  revalidatePath("/profil");
}

/**
 * Bannière de profil (PR 8/9) — URL uniquement, pas d'upload (décision
 * documentée dans le README). Vide = retour à la bannière par défaut
 * (dégradé CSS, `.profile-banner-default`). Validation minimale
 * (http/https) : c'est une simple `background-image` CSS, pas
 * `next/image`, donc pas de contrainte de domaine à vérifier — juste
 * s'assurer que ce n'est pas n'importe quoi (`javascript:`, etc.).
 */
export async function setBannerUrlAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const raw = String(formData.get("bannerUrl") ?? "").trim();

  if (!raw) {
    await prisma.user.update({ where: { id: user.id }, data: { bannerUrl: null } });
    revalidatePath("/profil");
    return;
  }

  if (!/^https?:\/\//i.test(raw)) return;

  await prisma.user.update({ where: { id: user.id }, data: { bannerUrl: raw } });
  revalidatePath("/profil");
}
