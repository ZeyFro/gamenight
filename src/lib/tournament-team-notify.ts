import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import type { DeliveryResolver } from "@/lib/notification-executor";
import { isTournamentTeamsEnabled } from "@/lib/tournament-teams-rules";
import { captainIdOf, captainSelect } from "@/lib/tournament-team-captain";

/**
 * Annonces CIBLÉES des tournois d'équipes : un MP par destinataire concerné (capitaine invité, capitaines au lancement,
 * capitaine qui doit confirmer un résultat, organisateur en cas de désaccord). Jamais de mention, jamais de message dans un
 * salon, aucun appel Discord direct : `NotificationEvent` ADMIN / `TOURNAMENT_TEAM_NOTIFY` + livraison MP via la file ;
 * le résolveur revérifie l'état courant à la livraison (rôle du destinataire, match encore ouvert…).
 */
export const TOURNAMENT_TEAM_NOTIFY = "TOURNAMENT_TEAM_NOTIFY";

export const noticeKinds = ["invited", "launched", "report_pending", "reminder", "dispute"] as const;
export type TeamTournamentNoticeKind = (typeof noticeKinds)[number];

const payloadSchema = z.object({ kind: z.enum(noticeKinds), matchId: z.string().min(1).optional(), teamId: z.string().min(1).optional(), key: z.string().min(1) });

export function teamTournamentNoticesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTournamentTeamsEnabled(env) && env.NOTIFICATION_EXECUTOR_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

const slotFor = (recipientId: string, tournamentId: string, kind: TeamTournamentNoticeKind, key: string) =>
  `account:${recipientId}:TOURNAMENT_TEAM:${tournamentId}:${kind}:${key}`;

/**
 * `key` rend le message idempotent et unique par occasion (ex. identifiant de déclaration, d'invitation) : un rejeu ne
 * renvoie jamais un second MP. Jamais bloquant pour l'action métier : un échec d'enfilage est journalisé.
 */
export async function enqueueTeamTournamentNotice(input: {
  communityId: string; tournamentId: string; kind: TeamTournamentNoticeKind; key: string;
  recipientIds: readonly string[]; matchId?: string; teamId?: string;
}): Promise<"queued" | "disabled" | "none"> {
  if (!teamTournamentNoticesEnabled()) return "disabled";
  const recipients = [...new Set(input.recipientIds)];
  if (!recipients.length) return "none";
  try {
    const event = await createNotificationEvent({
      communityId: input.communityId, category: "ADMIN", eventType: TOURNAMENT_TEAM_NOTIFY, sourceId: input.tournamentId,
      occurrence: `${input.kind}:${input.key}`,
      payload: { kind: input.kind, key: input.key, ...(input.matchId ? { matchId: input.matchId } : {}), ...(input.teamId ? { teamId: input.teamId } : {}) },
    });
    for (const recipientId of recipients) {
      await enqueueDelivery({
        eventId: event.id, channel: "DISCORD_DM", transport: "BOT", operation: "SEND",
        recipientKey: `user:${recipientId}`, targetSlot: slotFor(recipientId, input.tournamentId, input.kind, input.key),
      });
    }
    return "queued";
  } catch (error) {
    logger.warn("tournament-teams", "MP de tournoi d'équipes non enfilé.", { errorType: error instanceof Error ? error.name : "unknown" });
    return "none";
  }
}

export const teamTournamentNoticeResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== TOURNAMENT_TEAM_NOTIFY || !event.communityId) return { eligible: false, reason: "unresolvable" };
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    if (!teamTournamentNoticesEnabled()) return { eligible: false, reason: "not_configured" };
    const recipientId = delivery.recipientKey.startsWith("user:") ? delivery.recipientKey.slice(5) : "";
    const { kind, matchId, teamId, key } = payload.data;
    if (delivery.operation !== "SEND" || delivery.channel !== "DISCORD_DM" || delivery.transport !== "BOT" || !recipientId
      || delivery.targetSlot !== slotFor(recipientId, event.sourceId, kind, key)) return { eligible: false, reason: "unresolvable" };

    const communityId = event.communityId;
    const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
    const tournament = await scopedDb.tournament.findFirst({ where: { id: event.sourceId, communityId }, select: { id: true, name: true, status: true, createdById: true } });
    if (!tournament) return { eligible: false, reason: "expired" };

    let text: string;
    if (kind === "invited" || kind === "launched") {
      if (!teamId) return { eligible: false, reason: "unresolvable" };
      const entry = await scopedDb.tournamentTeamEntry.findFirst({
        where: { tournamentId: tournament.id, teamId, communityId },
        select: { status: true, team: { select: { name: true, ...captainSelect(communityId) } } },
      });
      if (!entry || captainIdOf(entry.team) !== recipientId) return { eligible: false, reason: "expired" };
      if (kind === "invited") {
        if (entry.status !== "INVITED" || tournament.status !== "REGISTRATION") return { eligible: false, reason: "expired" };
        text = `Ton équipe **${entry.team.name}** est invitée au tournoi **${tournament.name}**. Accepte ou refuse l'invitation en tant que capitaine :`;
      } else {
        if (entry.status !== "REGISTERED" || tournament.status !== "IN_PROGRESS") return { eligible: false, reason: "expired" };
        text = `Le tournoi **${tournament.name}** est lancé : l'équipe **${entry.team.name}** y participe. Chaque résultat doit être confirmé par les deux capitaines :`;
      }
    } else {
      if (!matchId || tournament.status !== "IN_PROGRESS") return { eligible: false, reason: "expired" };
      const match = await scopedDb.tournamentMatch.findFirst({
        where: { id: matchId, tournamentId: tournament.id },
        select: {
          completedAt: true, team1Id: true, team2Id: true,
          reports: { select: { teamId: true, winnerTeamId: true, score1: true, score2: true } },
          team1: { select: { name: true, registeredEntry: { select: { team: { select: captainSelect(communityId) } } } } },
          team2: { select: { name: true, registeredEntry: { select: { team: { select: captainSelect(communityId) } } } } },
        },
      });
      if (!match || match.completedAt) return { eligible: false, reason: "expired" };
      if (kind === "dispute") {
        if (recipientId !== tournament.createdById || match.reports.length < 2) return { eligible: false, reason: "expired" };
        text = `Désaccord sur le résultat de **${match.team1?.name ?? "?"}** contre **${match.team2?.name ?? "?"}** (tournoi **${tournament.name}**). Tranche en tant qu'organisateur :`;
      } else {
        const slot = [match.team1, match.team2].findIndex((team) => team?.registeredEntry?.team && captainIdOf(team.registeredEntry.team) === recipientId);
        if (slot === -1) return { eligible: false, reason: "expired" };
        const ownTeamId = slot === 0 ? match.team1Id : match.team2Id;
        const opponent = slot === 0 ? match.team2 : match.team1;
        if (match.reports.some((report) => report.teamId === ownTeamId) || match.reports.length !== 1) return { eligible: false, reason: "expired" };
        text = kind === "reminder"
          ? `Rappel : l'équipe **${opponent?.name ?? "adverse"}** a déclaré son résultat du tournoi **${tournament.name}** et attend ta confirmation :`
          : `L'équipe **${opponent?.name ?? "adverse"}** a déclaré le résultat de votre match du tournoi **${tournament.name}**. Confirme-le ou déclare le tien :`;
      }
    }
    const origin = resolveAbsoluteUrl(`/tournois/equipes/${tournament.id}`, {
      VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_URL: process.env.VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    });
    if (!origin || !process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const user = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { discordId: true, memberships: { where: { communityId, status: "ACTIVE", community: { status: "ACTIVE" } }, select: { id: true }, take: 1 } },
    });
    if (!user?.memberships.length) return { eligible: false, reason: "expired" };
    return {
      eligible: true,
      action: {
        kind: "send_direct_message", userId: user.discordId,
        message: { embeds: [{ title: `Tournoi d'équipes : ${tournament.name}`, description: `${text}\n${origin}`, color: 0x8b5cf6 }], allowedMentions: { parse: [] } },
      },
    };
  },
};
