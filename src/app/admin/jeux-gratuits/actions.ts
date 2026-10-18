"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { idSchema } from "@/lib/validations";
import { freeGameOfferSchema } from "@/lib/free-game-offer-rules";
import { wallClockNow } from "@/lib/wallclock";

function back(communityId: string, error?: string): never {
  const query = new URLSearchParams({ communityId });
  if (error) query.set("error", error);
  redirect(`/admin/jeux-gratuits?${query}`);
}

export async function createFreeGameOfferAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  const communityId = idSchema.safeParse(formData.get("communityId"));
  if (!communityId.success) redirect("/admin/jeux-gratuits?error=invalid");
  if (!checkRateLimit(admin.id, "createFreeGameOffer")) back(communityId.data, "rate_limited");
  if (formData.get("freeConfirmed") !== "on") back(communityId.data, "confirmation");

  const parsed = freeGameOfferSchema.safeParse({
    store: formData.get("store"),
    title: formData.get("title"),
    storeUrl: formData.get("storeUrl"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });
  if (!parsed.success || parsed.data.endsAt <= wallClockNow()) back(communityId.data, "invalid");

  const community = await prisma.community.findUnique({
    where: { id: communityId.data },
    select: { status: true, freeGamesEnabled: true },
  });
  if (!community || community.status !== "ACTIVE" || !community.freeGamesEnabled) back(communityId.data, "disabled");

  const scopedDb = await scopedPrismaForCommunityId(communityId.data);
  await scopedDb.freeGameOffer.create({ data: { ...parsed.data, communityId: communityId.data, createdById: admin.id } });
  revalidatePath("/jeux-gratuits");
  back(communityId.data);
}

export async function deleteFreeGameOfferAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  const communityId = idSchema.safeParse(formData.get("communityId"));
  const offerId = idSchema.safeParse(formData.get("id"));
  if (!communityId.success || !offerId.success) redirect("/admin/jeux-gratuits?error=invalid");
  if (!checkRateLimit(admin.id, "deleteFreeGameOffer")) back(communityId.data, "rate_limited");
  const scopedDb = await scopedPrismaForCommunityId(communityId.data);
  await scopedDb.freeGameOffer.deleteMany({ where: { id: offerId.data, communityId: communityId.data } });
  revalidatePath("/jeux-gratuits");
  back(communityId.data);
}
