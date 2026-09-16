"use server";

import { put } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { bannerUrlSchema, userColorSchema } from "@/lib/validations";
import {
  BANNER_MIME_TO_EXT,
  buildBannerBlobPathname,
  cleanupOrphanedBannerUpload,
  detectBannerImageSignature,
  safelyDeleteOldBannerBlob,
} from "@/lib/banner-blob";
import {
  isAvailableNotificationCategory,
  setOwnNotificationPreference,
} from "@/lib/notification-preferences";

/**
 * Couleur perso (PR 4/4, sous-PR 1) — "Ma couleur" sur `/profil/parametres`.
 * `colorCustomized: true` protège définitivement ce choix du backfill
 * `backfillUserColors` (`src/lib/backfill-user-colors.ts`), qui ne touche
 * que les comptes encore à la valeur par défaut.
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

  const enabled = user.silenceReminders;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { silenceReminders: !enabled },
    }),
    ...(["SESSION", "ROULETTE"] as const).map((category) =>
      prisma.userNotificationPreference.upsert({
        where: { userId_category: { userId: user.id, category } },
        create: { userId: user.id, category, enabled },
        update: { enabled },
      })
    ),
  ]);

  revalidatePath("/profil");
}

/**
 * Enregistre une catégorie pour l'utilisateur de la session uniquement :
 * aucun userId reçu du navigateur, donc impossible de cibler un tiers.
 */
export async function updateNotificationPreferenceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updateNotificationPreference")) {
    redirect("/profil/parametres?notifications=rate_limited");
  }

  const category = String(formData.get("category") ?? "");
  const enabledValue = String(formData.get("enabled") ?? "");
  if (!isAvailableNotificationCategory(category) || !["true", "false"].includes(enabledValue)) {
    redirect("/profil/parametres?notifications=invalide");
  }

  try {
    await setOwnNotificationPreference(user.id, category, enabledValue === "true");
  } catch (error) {
    logger.error("notification-preferences", error, { userId: user.id, category });
    redirect("/profil/parametres?notifications=erreur");
  }

  revalidatePath("/profil/parametres");
  redirect("/profil/parametres?notifications=ok");
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
 *
 * Durcissement (PR "Durcissement des bannières") — si l'utilisateur avait
 * précédemment uploadé une bannière vers Vercel Blob et bascule maintenant
 * sur une URL externe (ou vide sa bannière), l'ancien blob est nettoyé en
 * best-effort APRÈS le commit Prisma, jamais avant : si la suppression
 * échouait avant l'update, une bannière encore affichée en base pointerait
 * vers un fichier déjà détruit. `safelyDeleteOldBannerBlob` ne supprime de
 * toute façon que ce qui est prouvé nôtre pour CET utilisateur (voir
 * `src/lib/banner-blob.ts`) — jamais une URL externe, jamais le blob d'un
 * autre membre.
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
  const previousUrl = user.bannerUrl;

  await prisma.user.update({ where: { id: user.id }, data: { bannerUrl: raw || null } });
  revalidatePath("/profil");

  await safelyDeleteOldBannerBlob(previousUrl, raw, user.id);
}

const MAX_BANNER_UPLOAD_BYTES = 5 * 1024 * 1024;

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
 *
 * Durcissement (PR "Durcissement des bannières") — `file.type` n'est
 * qu'une déclaration du navigateur, trivialement falsifiable : le format
 * réel est désormais déterminé par lecture des premiers octets
 * (`detectBannerImageSignature`), jamais par ce champ. L'extension ET le
 * `contentType` passés à `put()` viennent du format détecté, pas du
 * fichier déclaré — le Content-Type servi par le CDN Vercel Blob devient
 * fiable. Le buffer analysé n'est qu'un extrait en lecture seule ; le
 * fichier original part intact vers `put()` (jamais retouché, un GIF reste
 * animé).
 *
 * Ordre des opérations, strict : upload du nouveau blob → mise à jour
 * Prisma → SI ÉCHEC, nettoyage du blob tout juste créé (`upload=echec`,
 * jamais d'orphelin) → SI SUCCÈS, nettoyage best-effort de l'ancien blob
 * (seulement s'il est prouvé nôtre pour CET utilisateur, cf.
 * `src/lib/banner-blob.ts`) → redirection. Ne jamais supprimer l'ancien
 * blob avant que la nouvelle valeur soit committée : un échec Prisma après
 * une suppression prématurée laisserait la base référencer une bannière
 * détruite.
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

  const headerBytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detectedMime = detectBannerImageSignature(headerBytes);
  if (!detectedMime) {
    redirect("/profil/parametres?upload=format");
  }
  const extension = BANNER_MIME_TO_EXT[detectedMime];

  const previousUrl = user.bannerUrl;
  const blob = await put(buildBannerBlobPathname(user.id, extension), file, {
    access: "public",
    addRandomSuffix: true,
    contentType: detectedMime,
  });

  try {
    await prisma.user.update({ where: { id: user.id }, data: { bannerUrl: blob.url } });
  } catch (error) {
    await cleanupOrphanedBannerUpload(blob.url);
    logger.error("banner-blob", error, { userId: user.id, effect: "prisma-update" });
    redirect("/profil/parametres?upload=echec");
  }

  revalidatePath("/profil");
  await safelyDeleteOldBannerBlob(previousUrl, blob.url, user.id);
  redirect("/profil/parametres?upload=ok");
}
