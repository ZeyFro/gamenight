"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { activateCommunity, isCommunityAdminEnabled, parseChannelCategory, setCommunityChannel, setCommunityGuide } from "@/lib/community-admin";

/**
 * Administration des communautés (drapeau COMMUNITY_ADMIN_ENABLED, onglet
 * « Communautés » de /admin). Chaque action revérifie le drapeau, l'accès admin
 * et l'état en base : un identifiant forgé ne change rien. Le résultat revient
 * dans l'URL sous forme d'un code court (`?r=`), affiché par l'onglet.
 */
const BACK = "/admin?tab=communautes";

function done(code: string): never {
  revalidatePath("/admin");
  redirect(`${BACK}&r=${code}`);
}

export async function activateCommunityAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "activateCommunity")) done("rate");

  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || communityId === "") done("invalid");
  done(`activate-${await activateCommunity(communityId, admin.id)}`);
}

export async function setCommunityChannelAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityChannel")) done("rate");

  const communityId = formData.get("communityId");
  const category = parseChannelCategory(formData.get("category"));
  const channelId = formData.get("channelId");
  if (typeof communityId !== "string" || communityId === "" || !category || typeof channelId !== "string") {
    done("invalid");
  }
  const result = await setCommunityChannel({ communityId, category, channelId: channelId.trim() });
  done(result.ok ? "channel-ok" : `channel-${result.reason}`);
}

export async function setCommunityGuideAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityGuide")) done("rate");

  const result = await setCommunityGuide({
    communityId: formData.get("communityId"),
    rules: formData.get("guideRules"),
    contacts: formData.get("guideContacts"),
  });
  done(result === "saved" ? "guide-ok" : `guide-${result}`);
}
