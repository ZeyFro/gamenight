"use server";

import { put } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { bannerUrlSchema, userColorSchema } from "@/lib/validations";

/**
 * Couleur perso (PR 4/4, sous-PR 1) — "Ma couleur" sur `/profil/parametres`.
 * `colorCustomized: true` protège définitivement ce choix du backfill
 * `prisma/backfill-user-colors.mjs`, qui ne touche que les comptes encore
 * à la valeur par défaut.
 */
export async function updateUserColor(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updateUserColor")) return;

  const input = userColorSchema.safeParse({
    color: String(formData.get("color") ?? "").trim(),
  });
  if (!input.success) return;
  const { color } = input.data;

  await prisma.user.update({
    where: { id: user.id },
    data: { color, colorCustomized: true },
  });

  revalidatePath("/profil");
  revalidatePath("/profil/parametres");
}

/** Bouton "🔕 Couper les rappels" du profil (F7) : ne touche qu'aux pings, pas à l'envoi du message. */
export async function toggleSilenceReminders() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "toggleSilenceReminders")) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { silenceReminders: !user.silenceReminders },
  });

  revalidatePath("/profil");
}

/**
 * Toggle "Sons" (Sprint 2 PR-C, U10) — n'affecte que la lecture locale
 * d'un son sur les célébrations (`CelebrationConfetti`), jamais les
 * webhooks Discord ni les notifications in-app elles-mêmes (qui restent
 * écrites en base même son coupé — seule la lecture audio est
 * conditionnée à ce champ).
 */
export async function toggleSoundEnabled() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "toggleSoundEnabled")) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { soundEnabled: !user.soundEnabled },
  });

  revalidatePath("/profil/parametres");
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
  if (!checkRateLimit(user.id, "setBannerUrlAction")) return;

  const input = bannerUrlSchema.safeParse({
    bannerUrl: String(formData.get("bannerUrl") ?? "").trim(),
  });
  if (!input.success) return;
  const { bannerUrl: raw } = input.data;

  if (!raw) {
    await prisma.user.update({ where: { id: user.id }, data: { bannerUrl: null } });
    revalidatePath("/profil");
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { bannerUrl: raw } });
  revalidatePath("/profil");
}

const MAX_BANNER_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_BANNER_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Upload de bannière (fix UX PR 9/9, suite au test prod de la PR 8/9 où
 * l'URL-only s'est révélée pénible sans image déjà hébergée). Vercel Blob
 * plutôt qu'un autre service : 5 Go gratuits sur le plan Hobby (largement
 * suffisant pour des bannières de profil), lit `BLOB_READ_WRITE_TOKEN`
 * automatiquement depuis l'env — pas de client à instancier à la main.
 * Dégradation propre si le token est absent (dev local sans Blob Store
 * configuré, ou déploiement où l'admin n'a pas encore créé le store) :
 * on renvoie vers `?upload=desactive` plutôt que de laisser `put()`
 * lever une exception non gérée.
 */
export async function uploadBannerAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "uploadBannerAction")) return;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    redirect("/profil/parametres?upload=desactive");
  }

  const file = formData.get("bannerFile");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/profil/parametres?upload=erreur");
  }
  if (file.size > MAX_BANNER_UPLOAD_BYTES) {
    redirect("/profil/parametres?upload=trop-lourd");
  }
  const extension = ALLOWED_BANNER_MIME_TO_EXT[file.type];
  if (!extension) {
    redirect("/profil/parametres?upload=format");
  }

  const blob = await put(`banners/${user.id}-${Date.now()}.${extension}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  await prisma.user.update({ where: { id: user.id }, data: { bannerUrl: blob.url } });
  revalidatePath("/profil");
  redirect("/profil/parametres?upload=ok");
}
