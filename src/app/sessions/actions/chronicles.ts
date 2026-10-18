"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { saveSessionChronicle } from "@/lib/session-chronicles";

export async function saveSessionChronicleAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const id = idSchema.safeParse(formData.get("sessionId"));
  if (!id.success) return;
  const path = `/sessions/${id.data}`;
  if (!checkRateLimit(user.id, "sessionChronicle")) redirect(`${path}?chronicle=rate`);
  if (!await saveSessionChronicle(user.id, id.data, formData.get("chronicle"))) redirect(`${path}?chronicle=invalid`);
  revalidatePath(path);
  revalidatePath("/profil/lore/chroniques");
  redirect(`${path}?chronicle=saved`);
}
