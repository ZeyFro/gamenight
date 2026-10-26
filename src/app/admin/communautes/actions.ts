"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { activateCommunity, isCommunityAdminEnabled, parseChannelCategory, setCommunityAttendanceXp, setCommunityChannel, setCommunityGuide, setCommunityFreeGames, setCommunitySteamPriceAlerts, setCommunityGroupPurchasePlans, setCommunityPlayerClassifieds, setCommunityTeams } from "@/lib/community-admin";
import { setCommunitySessionGallery } from "@/lib/community-admin";

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

export async function setCommunityFreeGamesAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityFreeGames")) done("rate");

  const enabled = formData.get("enabled");
  const result = await setCommunityFreeGames({
    communityId: formData.get("communityId"),
    enabled: enabled === "true" ? true : enabled === "false" ? false : null,
  });
  done(result === "saved" ? "free-games-ok" : `free-games-${result}`);
}

export async function setCommunitySteamPriceAlertsAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunitySteamPriceAlerts")) done("rate");
  const result = await setCommunitySteamPriceAlerts({
    communityId: formData.get("communityId"),
    enabled: formData.get("enabled") === "true",
    threshold: formData.get("threshold"),
  });
  done(result === "saved" ? "price-alerts-ok" : `price-alerts-${result}`);
}

export async function setCommunityGroupPurchasePlansAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityGroupPurchasePlans")) done("rate");
  const enabledValue = formData.get("enabled");
  const result = await setCommunityGroupPurchasePlans({
    communityId: formData.get("communityId"),
    enabled: enabledValue === "true" ? true : enabledValue === "false" ? false : null,
  });
  done(result === "saved" ? "purchase-plan-ok" : `purchase-plan-${result}`);
}

export async function setCommunityAttendanceXpAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityAttendanceXp")) done("rate");
  const result = await setCommunityAttendanceXp({
    communityId: formData.get("communityId"),
    enabled: formData.get("enabled") === "true" ? "true" : "false",
    bonusXp: formData.get("bonusXp"),
    absencePenaltyXp: formData.get("absencePenaltyXp"),
  });
  done(result === "saved" ? "attendance-ok" : `attendance-${result}`);
}

export async function setCommunityPlayerClassifiedsAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityPlayerClassifieds")) done("rate");

  const enabled = formData.get("enabled");
  const result = await setCommunityPlayerClassifieds({
    communityId: formData.get("communityId"),
    enabled: enabled === "true" ? true : enabled === "false" ? false : null,
  });
  done(result === "saved" ? "classifieds-ok" : `classifieds-${result}`);
}

export async function setCommunityTeamsAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityTeams")) done("rate");
  const enabled = formData.get("enabled");
  const result = await setCommunityTeams({ communityId: formData.get("communityId"), enabled: enabled === "true" ? true : enabled === "false" ? false : null });
  done(result === "saved" ? "teams-ok" : `teams-${result}`);
}

export async function setCommunitySessionGalleryAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunitySessionGallery")) done("rate");
  const result = await setCommunitySessionGallery({
    communityId: formData.get("communityId"),
    enabled: formData.get("enabled") === "on",
  });
  done(result === "saved" ? "gallery-ok" : `gallery-${result}`);
}
