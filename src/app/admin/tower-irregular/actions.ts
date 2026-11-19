"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { grantTowerIrregular, revokeTowerIrregular, getTowerIrregularCommunityId } from "@/lib/tower-irregular";

function done(result: string): never {
  revalidatePath("/admin/tower-irregular");
  redirect(`/admin/tower-irregular?result=${result}`);
}

async function authorized(action: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTowerIrregularCommunityId(user.id);
  if (!communityId) redirect("/admin/tower-irregular?result=unavailable");
  if (!checkRateLimit(user.id, action)) done("rate");
  return { user, communityId };
}

export async function grantTowerIrregularAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorized("grantTowerIrregular");
  done(await grantTowerIrregular(user.id, communityId, { userId: formData.get("userId") }));
}

export async function revokeTowerIrregularAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorized("revokeTowerIrregular");
  done(await revokeTowerIrregular(user.id, communityId, { userId: formData.get("userId") }));
}
