"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { setProfileVisibility } from "@/lib/profile-visibility";

export async function setProfileVisibilityAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const visibility = formData.get("visibility");
  if (visibility !== "COMMUNITY" && visibility !== "HIDDEN") redirect("/potes");
  if (!checkRateLimit(user.id, "setProfileVisibility")) redirect("/potes");
  // Le propriétaire est toujours l'utilisateur de la session : aucun identifiant n'est lu du formulaire.
  await setProfileVisibility(user.id, visibility);
  revalidatePath("/potes");
  redirect("/potes");
}
