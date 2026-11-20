"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { PROFILE_KIND_FIELD } from "@/lib/profile-cosmetics";
import { saveCustomization, setEffectsPreference, type SaveCustomizationInput } from "@/lib/profile-customization";

const BASE = "/profil/personnalisation";

function refresh() {
  revalidatePath("/profil");
  revalidatePath(BASE);
  revalidatePath("/potes", "layout");
}

/** Enregistre tous les choix du formulaire : un champ vide retire l'élément, la vitrine est validée côté serveur. */
export async function saveCustomizationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "saveCustomization")) redirect(`${BASE}?status=busy`);
  const communityId = await writeCommunityIdForUser(user.id);
  if (!communityId) redirect(`${BASE}?status=no_community`);

  const input: SaveCustomizationInput = {};
  for (const field of Object.values(PROFILE_KIND_FIELD)) {
    input[field] = String(formData.get(field) ?? "") || null;
  }
  input.showcaseBadgeIds = formData.getAll("showcase").map(String);

  const status = await saveCustomization(user.id, communityId, input);
  refresh();
  redirect(`${BASE}?status=${status}`);
}

/** Préférence du spectateur : voir ou non les effets animés des profils (en plus de prefers-reduced-motion). */
export async function setEffectsPreferenceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "setEffectsPreference")) redirect(`${BASE}?status=busy`);
  const status = await setEffectsPreference(user.id, formData.get("effects") === "on");
  refresh();
  redirect(`${BASE}?status=${status === "saved" ? "effects_saved" : "disabled"}`);
}
