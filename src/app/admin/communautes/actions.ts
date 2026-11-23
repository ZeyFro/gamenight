"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { activateCommunity, isCommunityAdminEnabled, parseChannelCategory, setCommunityAttendanceXp, setCommunityChannel, setCommunityGuide, setCommunityFreeGames, setCommunitySteamPriceAlerts, setCommunityGroupPurchasePlans, setCommunityPlayerClassifieds, setCommunityTeams, setCommunityTowerLevelsPerFloor } from "@/lib/community-admin";
import { setCommunitySessionGallery } from "@/lib/community-admin";
import { recordSensitiveOperation, type SensitiveOperation } from "@/lib/sensitive-operation-log";

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

/** Journal des opérations sensibles (cahier §19.1), puis retour à l'onglet avec le même code. */
async function logged(adminId: string, action: SensitiveOperation, communityId: FormDataEntryValue | null, code: string): Promise<never> {
  await recordSensitiveOperation({ actorId: adminId, action, communityId: typeof communityId === "string" ? communityId : null, outcome: code });
  done(code);
}

export async function activateCommunityAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "activateCommunity")) done("rate");

  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || communityId === "") done("invalid");
  await logged(admin.id, "community.activate", communityId, `activate-${await activateCommunity(communityId, admin.id)}`);
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
  await logged(admin.id, "community.channel", formData.get("communityId"), result.ok ? "channel-ok" : `channel-${result.reason}`);
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
  await logged(admin.id, "community.guide", formData.get("communityId"), result === "saved" ? "guide-ok" : `guide-${result}`);
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
  await logged(admin.id, "community.free_games", formData.get("communityId"), result === "saved" ? "free-games-ok" : `free-games-${result}`);
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
  await logged(admin.id, "community.steam_price_alerts", formData.get("communityId"), result === "saved" ? "price-alerts-ok" : `price-alerts-${result}`);
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
  await logged(admin.id, "community.group_purchase_plans", formData.get("communityId"), result === "saved" ? "purchase-plan-ok" : `purchase-plan-${result}`);
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
  await logged(admin.id, "community.attendance_xp", formData.get("communityId"), result === "saved" ? "attendance-ok" : `attendance-${result}`);
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
  await logged(admin.id, "community.player_classifieds", formData.get("communityId"), result === "saved" ? "classifieds-ok" : `classifieds-${result}`);
}

export async function setCommunityTeamsAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityTeams")) done("rate");
  const enabled = formData.get("enabled");
  const result = await setCommunityTeams({ communityId: formData.get("communityId"), enabled: enabled === "true" ? true : enabled === "false" ? false : null });
  await logged(admin.id, "community.teams", formData.get("communityId"), result === "saved" ? "teams-ok" : `teams-${result}`);
}

export async function setCommunityTowerLevelsPerFloorAction(formData: FormData): Promise<void> {
  if (!isCommunityAdminEnabled()) redirect("/admin");
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  if (!checkRateLimit(admin.id, "setCommunityTowerLevelsPerFloor")) done("rate");
  const result = await setCommunityTowerLevelsPerFloor({
    communityId: formData.get("communityId"),
    levelsPerFloor: formData.get("levelsPerFloor"),
  });
  await logged(admin.id, "community.tower_levels_per_floor", formData.get("communityId"), result === "saved" ? "tower-floor-ok" : `tower-floor-${result}`);
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
  await logged(admin.id, "community.session_gallery", formData.get("communityId"), result === "saved" ? "gallery-ok" : `gallery-${result}`);
}
