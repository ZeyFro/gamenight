import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { persistServerError } from "@/lib/error-log";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { dissolutionBlocker } from "@/lib/community-teams";
import { enqueueTeamSpaceSync, teamSpaceQueueEnabled } from "@/lib/discord-team-space-queue";

/**
 * D5 : balayage idempotent des équipes DISSOUTES dont les salons existent encore. Il rattrape trois cas :
 *   - un échec d'enfilement après la dissolution (la dissolution est faite, la suppression des salons n'a jamais été demandée) ;
 *   - une suppression abandonnée à l'exécution parce qu'un signalement, un défi ou une contestation était ouvert, quand le blocage tombe ;
 *   - la suppression d'un compte dont le dernier membre n'a pu dissoudre l'équipe (blocage), idem.
 * « Dissoute » = AUCUNE ligne de membre, lien `DiscordTeamSpace` non supprimé, AUCUN blocage ouvert (le recrutement est fermé ici si besoin : deux départs
 * simultanés peuvent laisser une équipe vide encore ouverte). Une équipe dont les membres existent encore
 * mais sont tous inactifs n'est JAMAIS dissoute ici (D5 exige une confirmation, qu'un cron ne peut pas donner).
 * File seulement (aucun appel Discord) : l'exécution revérifie toutes les conditions et retire les accès avant de supprimer. Branché sur le
 * cron des rappels existant, sans nouvelle route ni interrupteur ; sans effet quand la file des espaces d'équipe est fermée.
 */
export const TEAM_SPACE_SWEEP_BATCH = 25;
/** Une suppression déjà demandée récemment n'est pas redemandée à chaque passage du cron (évite d'empiler des événements pour une équipe coincée). */
export const TEAM_SPACE_SWEEP_RETRY_HOURS = 6;

export interface TeamSpaceSweepResult { enabled: boolean; checked: number; queued: number; blocked: number; failed: number }

export async function sweepDissolvedTeamSpaces(limit = TEAM_SPACE_SWEEP_BATCH, env: NodeJS.ProcessEnv = process.env): Promise<TeamSpaceSweepResult> {
  if (!teamSpaceQueueEnabled(env)) return { enabled: false, checked: 0, queued: 0, blocked: 0, failed: 0 };
  const retryAfter = new Date(Date.now() - TEAM_SPACE_SWEEP_RETRY_HOURS * 3_600_000);
  const rows = await prisma.$queryRaw<{ teamId: string; communityId: string }[]>`
    SELECT s."teamId", s."communityId"
    FROM "DiscordTeamSpace" s
    JOIN "CommunityTeam" t ON t."id" = s."teamId" AND t."communityId" = s."communityId"
    JOIN "Community" c ON c."id" = s."communityId"
    WHERE s."deletedAt" IS NULL
      AND c."status" = 'ACTIVE' AND c."communityTeamsEnabled" = true AND c."discordGuildId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "CommunityTeamMember" m WHERE m."teamId" = t."id" AND m."communityId" = t."communityId")
      -- Équipes BLOQUÉES exclues dans la requête (jamais en tête du LIMIT : 25 équipes bloquées n'affament pas une équipe libre).
      AND NOT EXISTS (SELECT 1 FROM "TowerChallengeAttempt" a WHERE a."teamId" = t."id" AND a."communityId" = t."communityId" AND a."status" IN ('ASSIGNED', 'SUBMITTED'))
      AND NOT EXISTS (
        SELECT 1 FROM "TowerChallengeAppeal" ap JOIN "TowerChallengeAttempt" a2 ON a2."id" = ap."attemptId" AND a2."communityId" = ap."communityId"
        WHERE a2."teamId" = t."id" AND ap."communityId" = t."communityId" AND ap."status" = 'OPEN'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "ModerationReport" r
        WHERE r."communityId" = s."communityId" AND r."closedAt" IS NULL AND r."channelId" IN (s."channelId", s."voiceChannelId")
      )
      AND NOT EXISTS (
        SELECT 1 FROM "NotificationEvent" e
        WHERE e."eventType" = 'TEAM_SPACE_SYNC' AND e."sourceId" = t."id" AND e."createdAt" > ${retryAfter}
          AND jsonb_exists(e."payload"::jsonb, 'intent') AND e."payload"::jsonb ->> 'intent' = 'delete'
      )
    ORDER BY s."updatedAt" ASC, s."teamId" ASC
    LIMIT ${limit}
  `;
  const result: TeamSpaceSweepResult = { enabled: true, checked: rows.length, queued: 0, blocked: 0, failed: 0 };
  for (const row of rows) {
    try {
      const scopedDb = scopedPrisma({ communityIds: [row.communityId], includesDefault: false });
      if (await dissolutionBlocker(scopedDb as never, row.communityId, row.teamId)) { result.blocked += 1; continue; }
      // Équipe vide : plus de candidats pendant que ses salons sont supprimés (sans effet si quelqu'un l'a rejointe entre-temps).
      await scopedDb.communityTeam.updateMany({ where: { id: row.teamId, communityId: row.communityId, members: { none: {} } }, data: { isRecruiting: false } });
      const queued = await enqueueTeamSpaceSync({ intent: "delete", communityId: row.communityId, teamId: row.teamId });
      if (queued === "queued") {
        result.queued += 1;
      } else {
        result.failed += 1;
        if (queued === "error") {
          // Échec technique d'enfilement : visible (journal des erreurs), réessayé au passage suivant (aucun événement n'a été créé).
          logger.error("discord-team-space", "Balayage : suppression des salons non enfilée.", { teamId: row.teamId });
          persistServerError("cron:reminders", new Error("team_space_enqueue_failed"), { route: "cron/reminders", code: "team_space_sweep" });
        } else {
          logger.warn("discord-team-space", "Balayage : suppression des salons non enfilée (file fermée ou communauté non reliée).", { teamId: row.teamId, result: queued });
        }
      }
    } catch (error) {
      // Journalisé, jamais silencieux ; le prochain passage réessaie (aucun événement n'a été créé).
      result.failed += 1;
      logger.error("discord-team-space", "Balayage : suppression des salons non enfilée.", { teamId: row.teamId, errorType: error instanceof Error ? error.name : "unknown" });
      persistServerError("cron:reminders", error, { route: "cron/reminders", code: "team_space_sweep" });
    }
  }
  return result;
}
