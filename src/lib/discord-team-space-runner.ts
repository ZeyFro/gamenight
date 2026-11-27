import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { DiscordRestFailure, DiscordRestResult } from "@/lib/discord-rest";
import { createDiscordTeamSpaceApi } from "@/lib/discord-team-space-api";
import {
  deleteTeamSpace,
  provisionTeamSpace,
  reconcileTeamSpace,
  syncTeamSpaceMember,
  type TeamSpaceDiscordApi,
} from "@/lib/discord-team-space-service";

/**
 * Exécution d'une action d'espace d'équipe PAR L'EXECUTOR de notifications
 * (`performDiscordAction`, action `sync_team_space`). C'est le seul chemin qui
 * écrit sur Discord pour un espace d'équipe : ni `/equipe`, ni `/projet`, ni une
 * action web n'appellent `discord-team-space-api` directement ; ils enfilent un
 * événement (`discord-team-space-queue.ts`).
 *
 * Idempotent : un rejeu (bail expiré, `network_uncertain`) retombe sur le lien
 * persisté ou sur le nom exact du salon, jamais sur une approximation. Aucune
 * suppression : archiver = renommer.
 */
export type TeamSpaceIntent = "provision" | "member" | "reconcile" | "delete";

export interface TeamSpaceActionInput {
  intent: TeamSpaceIntent;
  teamId: string;
  communityId: string;
  /** Requis pour `member` : l'état courant décide de l'ajout ou du retrait du rôle. */
  discordId?: string;
  /** Acteur de la dissolution, transporté jusqu'au journal C055. */
  actorUserId?: string;
  /** Membres présents avant dissolution : accès retirés avant la suppression. */
  formerMemberDiscordIds?: readonly string[];
}

const retryable = (message: string): DiscordRestFailure => ({ ok: false, kind: "server_error", message, retryable: true });
const definitive = (message: string): DiscordRestFailure => ({ ok: false, kind: "invalid_request", message, retryable: false });
const ok = { ok: true, data: {} } as const;

/** Statut de service → résultat d'exécuteur. Un échec définitif n'est jamais rejoué. */
function fromStatus(status: string): DiscordRestResult<Record<string, never>> {
  switch (status) {
    case "created":
    case "reused":
    case "updated":
    case "removed":
    case "deleted":
    case "already_deleted":
    case "consistent":
    case "repaired":
    // Rien à faire : espace pas encore créé ou plus de lien (aucune ressource à toucher).
    case "unlinked":
    case "not_provisioned":
    // L'équipe a été repeuplée ou un signalement s'est ouvert : rien à supprimer.
    case "not_dissolved":
    case "open_report":
    // Condition de dissolution changée depuis la demande (défi relancé, contestation ouverte) : abandon terminal, déjà tracé.
    case "blocked":
      return ok;
    case "partial":
    case "failed":
      return retryable(`Espace d'équipe : ${status}.`);
    // Capacité Discord insuffisante : aucune reprise automatique, le staff décide.
    // Un identifiant enregistré ne désigne plus notre salon (type ou salon système) : jamais supprimé, jamais rejoué, le staff décide.
    case "mismatch":
    case "capacity":
    case "quota":
      return definitive("Capacité Discord des espaces d'équipe atteinte.");
    default:
      return definitive(`Espace d'équipe non appliqué : ${status}.`);
  }
}

/** Statuts après lesquels la suppression ne sera jamais rejouée avec la même charge (succès, état cible ou abandon terminal). */
const TERMINAL_DELETE_STATUSES = new Set(["deleted", "already_deleted", "unlinked", "not_dissolved", "open_report", "blocked", "mismatch"]);

/** Retire `formerMemberDiscordIds` des événements d'espace de CETTE équipe ; un échec est journalisé (jamais silencieux) et n'invalide pas la suppression. */
async function scrubFormerMemberIds(teamId: string, communityId: string): Promise<void> {
  try {
    // « TEAM_SPACE_SYNC » = TEAM_SPACE_EVENT (discord-team-space-queue.ts, non importé ici pour éviter un cycle).
    await prisma.$executeRaw`UPDATE "NotificationEvent" SET "payload" = ("payload"::jsonb - 'formerMemberDiscordIds')
      WHERE "eventType" = 'TEAM_SPACE_SYNC' AND "sourceId" = ${teamId} AND "communityId" = ${communityId}
        AND jsonb_exists("payload"::jsonb, 'formerMemberDiscordIds')`;
  } catch (error) {
    logger.warn("discord-team-space", "Identifiants des anciens membres non purgés de l'événement.", { teamId, errorType: error instanceof Error ? error.name : "unknown" });
  }
}

export async function runTeamSpaceAction(
  input: TeamSpaceActionInput,
  deadline: Date,
  api: TeamSpaceDiscordApi = createDiscordTeamSpaceApi(deadline)
): Promise<DiscordRestResult<Record<string, never>>> {
  const base = { teamId: input.teamId, communityId: input.communityId, api };
  try {
    if (input.intent === "provision") return fromStatus((await provisionTeamSpace(base)).status);
    if (input.intent === "reconcile") return fromStatus((await reconcileTeamSpace(base)).status);
    if (input.intent === "delete") {
      const { status } = await deleteTeamSpace({ ...base, actorId: input.actorUserId, formerMemberDiscordIds: input.formerMemberDiscordIds });
      // Traitement terminal : les identifiants Discord des anciens membres n'ont plus d'utilité dans la charge de l'événement (minimisation).
      if (TERMINAL_DELETE_STATUSES.has(status)) await scrubFormerMemberIds(input.teamId, input.communityId);
      return fromStatus(status);
    }
    if (!input.discordId) return definitive("Membre Discord manquant pour la synchronisation d'accès.");
    const join = await syncTeamSpaceMember({ ...base, discordId: input.discordId, action: "join" });
    // Plus membre actif de l'équipe : retrait du seul rôle de CETTE équipe.
    if (join.status !== "not_member") return fromStatus(join.status);
    return fromStatus((await syncTeamSpaceMember({ ...base, discordId: input.discordId, action: "leave" })).status);
  } catch (error) {
    logger.warn("discord-team-space", "Exécution d'espace d'équipe impossible.", {
      intent: input.intent,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return retryable("Exécution d'espace d'équipe impossible.");
  }
}
