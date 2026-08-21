"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

/** Bouton "🔕 Couper les rappels" du profil (F7) : ne touche qu'aux pings, pas à l'envoi du message. */
export async function toggleSilenceReminders() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  await prisma.user.update({
    where: { id: user.id },
    data: { silenceReminders: !user.silenceReminders },
  });

  revalidatePath("/profil");
}
