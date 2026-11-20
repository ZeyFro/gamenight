import { logger } from "@/lib/logger";
import type { DiscordRestFailure, DiscordRestResult } from "@/lib/discord-rest";
import { createDiscordProjectSpaceApi } from "@/lib/project-space-api";
import { archiveProjectSpace, provisionProjectSpace, syncProjectSpaceMember, type ProjectSpaceApi } from "@/lib/project-space-service";

/**
 * Exécution d'une action de fils de projet PAR L'EXECUTOR (action `sync_project_space`) : seul chemin
 * d'écriture Discord pour les projets.
 */
export type ProjectSpaceIntent = "provision" | "member" | "archive";

export interface ProjectSpaceActionInput {
  intent: ProjectSpaceIntent;
  projectId: string;
  communityId: string;
  /** Requis pour `member`. */
  discordId?: string;
}

const retryable = (message: string): DiscordRestFailure => ({ ok: false, kind: "server_error", message, retryable: true });
const definitive = (message: string): DiscordRestFailure => ({ ok: false, kind: "invalid_request", message, retryable: false });
const ok = { ok: true, data: {} } as const;

export function fromProjectSpaceStatus(status: string): DiscordRestResult<Record<string, never>> {
  switch (status) {
    case "created":
    case "reused":
    case "updated":
    case "archived":
    // Rien à faire : projet fermé, pas encore dû ou sans fil.
    case "nothing_to_do":
    case "not_open":
    case "not_due":
      return ok;
    case "failed":
      return retryable(`Fils de projet : ${status}.`);
    default:
      return definitive(`Fils de projet non appliqués : ${status}.`);
  }
}

export async function runProjectSpaceAction(
  input: ProjectSpaceActionInput,
  deadline: Date,
  api: ProjectSpaceApi = createDiscordProjectSpaceApi(deadline)
): Promise<DiscordRestResult<Record<string, never>>> {
  try {
    if (input.intent === "provision") return fromProjectSpaceStatus((await provisionProjectSpace({ projectId: input.projectId, api })).status);
    if (input.intent === "archive") return fromProjectSpaceStatus((await archiveProjectSpace({ projectId: input.projectId, api })).status);
    if (!input.discordId) return definitive("Membre Discord manquant pour la synchronisation d'accès.");
    return fromProjectSpaceStatus((await syncProjectSpaceMember({ projectId: input.projectId, discordId: input.discordId, api })).status);
  } catch (error) {
    logger.warn("project-space", "Exécution des fils de projet impossible.", { intent: input.intent, errorType: error instanceof Error ? error.name : "unknown" });
    return retryable("Exécution des fils de projet impossible.");
  }
}
