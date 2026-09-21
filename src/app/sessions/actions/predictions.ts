"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { submitPronostic, getPronosticEligibleUsers } from "@/lib/pronostics";
import { placeBet } from "@/lib/xp-bets";
import { canAccessSession } from "@/lib/session-access";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import { pronosticSchema, xpBetSchema } from "@/lib/validations";
import type { ToggleVoteResult } from "./proposals-votes";

/**
 * Sprint 4 (Pronostics) — "🔮 Qui va carry ?" sur une soirée `SCHEDULED`.
 * Réservée aux mêmes participants que le vote de superlatifs à venir
 * (`getPronosticEligibleUsers`, même définition de présence que partout
 * ailleurs) — pas de sens à prédire pour une soirée à laquelle on ne
 * participe pas. 1 seul prono par personne (contrainte unique côté
 * `submitPronostic`, retombe silencieusement en cas de doublon).
 *
 * Infra (Sprint 5 suite, I2) — renvoie un résultat (au lieu d'un simple
 * `void`), même contrat que `ToggleVoteResult` : `PronosticForm` fait une
 * mise à jour optimiste avant d'appeler cette action, elle doit pouvoir
 * la défaire si la requête est refusée plutôt que de laisser affiché "Pronostic
 * enregistré" alors que rien n'a été enregistré côté serveur.
 */
export async function submitPronosticAction(formData: FormData): Promise<ToggleVoteResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "submitPronostic")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const input = pronosticSchema.safeParse({
    sessionId: String(formData.get("sessionId") ?? ""),
    predictedUserId: String(formData.get("predictedUserId") ?? ""),
  });
  if (!input.success) return { ok: true };
  const { sessionId, predictedUserId } = input.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, decidedGameId: true },
  });
  if (!session || session.status !== "SCHEDULED" || !session.decidedGameId) return { ok: true };
  // Confidentialité des soirées — défense en profondeur, en plus du
  // filtre "a voté le jeu gagnant" ci-dessous (déjà indirectement protégé
  // une fois le vote lui-même gated, mais vérifié explicitement ici plutôt
  // que de dépendre d'une chaîne indirecte).
  if (!(await canAccessSession(user.id, sessionId))) return { ok: true };

  const eligible = await getPronosticEligibleUsers(sessionId, session.decidedGameId);
  const eligibleIds = new Set(eligible.map((u) => u.id));
  if (!eligibleIds.has(user.id) || !eligibleIds.has(predictedUserId)) return { ok: true };
  if (predictedUserId === user.id) return { ok: true };

  await submitPronostic(sessionId, user.id, predictedUserId);
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

/**
 * Sprint 4 (Paris d'XP) — "🎲 Paris" sur une soirée `SCHEDULED`, mêmes
 * participants éligibles que les pronostics ci-dessus. La validation des
 * bornes réelles (10-50% du solde, tranches de 10) vit dans `placeBet`
 * (src/lib/xp-bets.ts) — zod ne garantit ici que la forme.
 */
export async function placeBetAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "placeBet")) return;

  const input = xpBetSchema.safeParse({
    sessionId: String(formData.get("sessionId") ?? ""),
    targetUserId: String(formData.get("targetUserId") ?? ""),
    amount: String(formData.get("amount") ?? ""),
  });
  if (!input.success) return;
  const { sessionId, targetUserId, amount } = input.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, decidedGameId: true },
  });
  if (!session || session.status !== "SCHEDULED" || !session.decidedGameId) return;
  if (!(await canAccessSession(user.id, sessionId))) return;

  const eligible = await getPronosticEligibleUsers(sessionId, session.decidedGameId);
  const eligibleIds = new Set(eligible.map((u) => u.id));
  if (!eligibleIds.has(user.id) || !eligibleIds.has(targetUserId)) return;
  if (targetUserId === user.id) return;

  await placeBet(sessionId, user.id, targetUserId, amount);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/profil");
}
