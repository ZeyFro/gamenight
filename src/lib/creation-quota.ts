import type { Prisma } from "@prisma/client";
import { checkSharedRateLimit } from "@/lib/shared-rate-limit";

/**
 * Plafond de créations par personne et par jour (audit 1.14, décision du propriétaire) : 10 soirées et 5 tournois.
 * Une « soirée » est une ligne `Session` (formulaire /sessions, `/soiree creer`, roulette « mode instantané »,
 * choix d'un créneau de sondage) ; un « tournoi » est une ligne `Tournament` (individuel ou par équipes). Une série
 * récurrente envoyée en une seule fois compte pour UNE soirée.
 *
 * Compteur PARTAGÉ (`checkSharedRateLimit`, table `RateLimitWindow`, fenêtre fixe de 24 h alignée sur le jour UTC,
 * limite en mémoire appliquée d'abord). Les appelants le consomment DANS la transaction de création, avec le client de
 * transaction : une création annulée ou rejouée (même clé d'intention) ne consomme rien, et un refus n'écrit ni soirée
 * ni notification. Jamais sur une route non authentifiée (une écriture en base par appel).
 */
export const DAILY_SESSION_CREATION_LIMIT = 10;
export const DAILY_TOURNAMENT_CREATION_LIMIT = 5;
export const DAILY_CREATION_WINDOW_MS = 86_400_000;

export type CreationQuotaKind = "SESSION" | "TOURNAMENT";

const QUOTAS: Record<CreationQuotaKind, { action: string; limit: number }> = {
  SESSION: { action: "dailyCreateSession", limit: DAILY_SESSION_CREATION_LIMIT },
  TOURNAMENT: { action: "dailyCreateTournament", limit: DAILY_TOURNAMENT_CREATION_LIMIT },
};

/** Clés `?error=` / `?result=` des redirections, mappées aux messages par chaque page. */
export const SESSION_QUOTA_ERROR_KEY = "quota_soirees_jour";
export const TOURNAMENT_QUOTA_ERROR_KEY = "quota_tournois_jour";

export const SESSION_QUOTA_MESSAGE =
  `Tu as atteint la limite de ${DAILY_SESSION_CREATION_LIMIT} soirées créées par jour. Réessaie demain.`;
export const TOURNAMENT_QUOTA_MESSAGE =
  `Tu as atteint la limite de ${DAILY_TOURNAMENT_CREATION_LIMIT} tournois créés par jour. Réessaie demain.`;

/** Levée dans la transaction de création : elle est annulée en entier, rien n'est écrit. */
export class DailyCreationLimitError extends Error {
  constructor(readonly kind: CreationQuotaKind) {
    super(kind === "SESSION" ? "daily_session_limit" : "daily_tournament_limit");
    this.name = "DailyCreationLimitError";
  }
}

export function dailyQuotaMessage(kind: CreationQuotaKind): string {
  return kind === "SESSION" ? SESSION_QUOTA_MESSAGE : TOURNAMENT_QUOTA_MESSAGE;
}

export function dailyQuotaErrorKey(kind: CreationQuotaKind): string {
  return kind === "SESSION" ? SESSION_QUOTA_ERROR_KEY : TOURNAMENT_QUOTA_ERROR_KEY;
}

/** `true` si la création est autorisée (et comptée), `false` au-delà du plafond du jour. */
export async function consumeDailyCreationQuota(
  kind: CreationQuotaKind,
  userId: string,
  client?: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">,
): Promise<boolean> {
  const { action, limit } = QUOTAS[kind];
  return checkSharedRateLimit(userId, action, { limit, windowMs: DAILY_CREATION_WINDOW_MS }, Date.now(), client);
}

/** Comme `consumeDailyCreationQuota`, mais lève `DailyCreationLimitError` pour annuler la transaction appelante. */
export async function assertDailyCreationQuota(
  kind: CreationQuotaKind,
  userId: string,
  client?: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">,
): Promise<void> {
  if (!await consumeDailyCreationQuota(kind, userId, client)) throw new DailyCreationLimitError(kind);
}
