import { logger } from "@/lib/logger";
import type { DiscordRestFailure, DiscordRestResult } from "@/lib/discord-rest";
import { createDiscordSessionSpaceApi } from "@/lib/session-space-api";
import {
  cleanupSessionSpace,
  provisionSessionSpace,
  syncSessionSpaceMember,
  type SessionSpaceApi,
} from "@/lib/session-space-service";
import type { SessionSpaceIntent } from "@/lib/session-space-plan";

/**
 * Exécution d'une action d'espace de soirée PAR L'EXECUTOR (action `sync_session_space`).
 * Seul chemin qui écrit sur Discord pour cet espace ; aucune action web n'appelle l'adaptateur.
 */
export interface SessionSpaceActionInput {
  intent: SessionSpaceIntent;
  sessionId: string;
  communityId: string;
  /** Requis pour `member`. */
  discordId?: string;
}

const retryable = (message: string): DiscordRestFailure => ({ ok: false, kind: "server_error", message, retryable: true });
const definitive = (message: string): DiscordRestFailure => ({ ok: false, kind: "invalid_request", message, retryable: false });
const ok = { ok: true, data: {} } as const;

/** Statut de service → résultat d'exécuteur. « Occupé » est rejoué plus tard (retryable). */
export function fromSessionSpaceStatus(status: string): DiscordRestResult<Record<string, never>> {
  switch (status) {
    case "created":
    case "reused":
    case "updated":
    case "cleaned":
    // Rien à faire : espace pas encore dû, déjà nettoyé, soirée solo ou jamais créé.
    case "nothing_to_do":
    case "not_due":
    case "too_small":
      return ok;
    case "occupied":
    case "not_ended":
    case "partial":
    case "failed":
      return retryable(`Espace de soirée : ${status}.`);
    default:
      return definitive(`Espace de soirée non appliqué : ${status}.`);
  }
}

export async function runSessionSpaceAction(
  input: SessionSpaceActionInput,
  deadline: Date,
  api: SessionSpaceApi = createDiscordSessionSpaceApi(deadline)
): Promise<DiscordRestResult<Record<string, never>>> {
  try {
    if (input.intent === "provision") return fromSessionSpaceStatus((await provisionSessionSpace({ sessionId: input.sessionId, api })).status);
    if (input.intent === "cleanup") return fromSessionSpaceStatus((await cleanupSessionSpace({ sessionId: input.sessionId, api })).status);
    if (!input.discordId) return definitive("Membre Discord manquant pour la synchronisation d'accès.");
    return fromSessionSpaceStatus((await syncSessionSpaceMember({ sessionId: input.sessionId, discordId: input.discordId, api })).status);
  } catch (error) {
    logger.warn("session-space", "Exécution d'espace de soirée impossible.", {
      intent: input.intent,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return retryable("Exécution d'espace de soirée impossible.");
  }
}
