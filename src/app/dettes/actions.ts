"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { setDebtGageSchema } from "@/lib/validations";
import { wallClockNow } from "@/lib/wallclock";

/**
 * Fixe (ou modifie) le texte du gage — réservé au créateur de la soirée
 * qui a généré la dette (`Debt.session.createdById`), pas au débiteur
 * lui-même : "gage défini par le créateur" (spec). Modifiable tant que la
 * dette n'est pas soldée (pas de garde d'unicité comme sur les résultats
 * de soirée : un gage peut raisonnablement être ajusté avant d'être payé).
 */
export async function setDebtGageAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "setDebtGage")) return;

  const input = setDebtGageSchema.safeParse({
    debtId: String(formData.get("debtId") ?? ""),
    gage: String(formData.get("gage") ?? ""),
  });
  if (!input.success) return;
  const { debtId, gage } = input.data;

  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { paidAt: true, session: { select: { createdById: true } } },
  });
  if (!debt || debt.paidAt || debt.session.createdById !== user.id) return;

  await prisma.debt.update({ where: { id: debtId }, data: { gage } });
  revalidatePath("/");
}

/** Marque une dette comme soldée — même restriction créateur que ci-dessus. */
export async function markDebtPaidAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "markDebtPaid")) return;

  const debtId = String(formData.get("debtId") ?? "");
  if (!debtId) return;

  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { paidAt: true, session: { select: { createdById: true } } },
  });
  if (!debt || debt.paidAt || debt.session.createdById !== user.id) return;

  await prisma.debt.update({ where: { id: debtId }, data: { paidAt: wallClockNow() } });
  revalidatePath("/");
}
