"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { playerEquipmentSchema } from "@/lib/player-equipment";

export async function updatePlayerEquipmentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updatePlayerEquipment")) redirect("/profil/parametres?materiel=rate_limited");
  const parsed = playerEquipmentSchema.safeParse({
    inputDevices: formData.getAll("inputDevices"),
    availablePlatforms: formData.getAll("availablePlatforms"),
    microphoneAvailable: formData.get("microphoneAvailable"),
  });
  if (!parsed.success) redirect("/profil/parametres?materiel=invalide");
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/profil/parametres");
  revalidatePath(`/potes/${user.id}`, "layout");
  redirect("/profil/parametres?materiel=ok");
}
