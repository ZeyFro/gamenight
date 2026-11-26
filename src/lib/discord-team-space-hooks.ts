import { logger } from "@/lib/logger";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { enqueueTeamSpaceSync, teamSpaceQueueEnabled } from "@/lib/discord-team-space-queue";

/**
 * Points d'accroche des services d'équipe (`/equipe rejoindre`, `/projet`,
 * actions web) vers la file des espaces Discord. Sans `DISCORD_TEAM_SPACES_ENABLED`
 * (et le reste des verrous de `teamSpaceQueueEnabled`) ce sont des no-op sans
 * lecture en base. Jamais d'appel Discord ici : uniquement la file.
 */

/** Équipe nouvellement créée (option A) : provisionne texte + vocal sans attendre une commande. */
export async function requestTeamSpaceProvision(input: { communityId: string; teamId: string }): Promise<void> {
  if (!teamSpaceQueueEnabled()) return;
  await enqueueTeamSpaceSync({ intent: "provision", communityId: input.communityId, teamId: input.teamId });
}

/**
 * Après une création d'équipe dont le service ne renvoie que le statut : retrouve
 * l'équipe du créateur (une seule par joueur et par communauté) puis enfile le
 * provisionnement. No-op sans les drapeaux, sans aucune lecture en base.
 */
export async function requestTeamSpaceProvisionForCreator(input: { communityId: string; userId: string }): Promise<void> {
  if (!teamSpaceQueueEnabled()) return;
  try {
    const scopedDb = scopedPrisma({ communityIds: [input.communityId], includesDefault: false });
    const team = await scopedDb.communityTeam.findFirst({
      where: { communityId: input.communityId, createdById: input.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (team) await enqueueTeamSpaceSync({ intent: "provision", communityId: input.communityId, teamId: team.id });
  } catch (error) {
    logger.warn("discord-team-space", "Provisionnement d’une nouvelle équipe non enfilé.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
}

/** Adhésion ou départ d'un membre : l'executor relit l'état courant et ajoute ou retire le rôle de CETTE équipe. */
export async function requestTeamSpaceMemberSync(input: {
  communityId: string;
  teamId: string;
  discordId: string | null | undefined;
}): Promise<void> {
  if (!input.discordId || !teamSpaceQueueEnabled()) return;
  await enqueueTeamSpaceSync({ intent: "member", communityId: input.communityId, teamId: input.teamId, discordId: input.discordId });
}

/** Identifiants Discord des membres avant une dissolution, pour retirer leur rôle ensuite. */
export async function listTeamMemberDiscordIds(communityId: string, teamId: string): Promise<string[]> {
  if (!teamSpaceQueueEnabled()) return [];
  try {
    const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
    const rows = await scopedDb.communityTeamMember.findMany({
      where: { teamId, communityId },
      select: { user: { select: { discordId: true } } },
      take: 50,
    });
    return rows.map((row) => row.user.discordId).filter((id): id is string => Boolean(id));
  } catch (error) {
    logger.warn("discord-team-space", "Membres de l'équipe illisibles avant dissolution.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return [];
  }
}

/** Après dissolution : suppression réelle des deux salons enregistrés (identifiants de CETTE équipe). */
export async function requestTeamSpaceAfterDissolution(input: {
  communityId: string;
  teamId: string;
  formerMemberDiscordIds: readonly string[];
}): Promise<void> {
  if (!teamSpaceQueueEnabled()) return;
  await enqueueTeamSpaceSync({ intent: "delete", communityId: input.communityId, teamId: input.teamId });
}
