import { NOT_CONFIGURED_RESOLVER, type DeliveryResolver } from "@/lib/notification-executor";
import { sessionAnnounceResolver } from "@/lib/session-announce";
import { tournamentAnnounceResolver } from "@/lib/tournament-announce";
import { instantSessionInviteResolver } from "@/lib/instant-session-announce";
import { rouletteDmResolver } from "@/lib/roulette-dm";
import { communitySystemAnnounceResolver } from "@/lib/community-announce";
import { onboardingReminderResolver } from "@/lib/onboarding-reminder";
import { TOWER_VOTE_EVENT_TYPES, towerChallengeAnnounceResolver } from "@/lib/tower-challenge-announcements";
import { TOWER_STEAM_EVENT_TYPES, towerSteamAnnounceResolver } from "@/lib/tower-steam-announcements";
import { TEAM_SPACE_EVENT, teamSpaceSyncResolver } from "@/lib/discord-team-space-queue";
import { MODERATION_REPORT_EVENT, reportTicketResolver } from "@/lib/discord-report-command";
import { PROJECT_SYNC_EVENT, projectSyncResolver } from "@/lib/project-space-queue";
import { ROLE_AUTOCREATE_EVENT, roleCreationResolver } from "@/lib/discord-role-autocreate";
import { TOURNAMENT_TEAM_NOTIFY, teamTournamentNoticeResolver } from "@/lib/tournament-team-notify";
import { sessionSpaceSyncResolver } from "@/lib/session-space-queue";
import { SESSION_SPACE_EVENT } from "@/lib/session-space-plan";
import { TEAM_APPLICATION_NOTIFY, teamApplicationNoticeResolver } from "@/lib/team-application-notify";

/**
 * Dispatche par catégorie d'événement — SESSION vers le résolveur du
 * chantier annonces bot (`session-announce.ts`), TOURNAMENT vers celui du
 * chantier annonces tournois (`tournament-announce.ts`), INSTANT_SESSION
 * (V2, "Jouer maintenant") vers celui des invitations rapides par MP
 * (`instant-session-announce.ts`), tout le reste vers
 * `NOT_CONFIGURED_RESOLVER`, qui refuse systématiquement. Brancher ces
 * résolveurs ici n'a par lui-même AUCUN effet tant que
 * `NOTIFICATION_EXECUTOR_ENABLED` et le flag catégorie correspondant
 * (`DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`/`DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`/
 * `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`) ne sont pas TOUS LES DEUX
 * activés (verrous indépendants PAR CATÉGORIE, voir `discord-bot-config.ts`)
 * — et tant qu'aucune livraison de cette catégorie n'existe.
 */
export const DISPATCH_RESOLVER: DeliveryResolver = {
  async resolve(input) {
    if (input.event.category === "ACHIEVEMENT" && TOWER_VOTE_EVENT_TYPES.includes(input.event.eventType)) return towerChallengeAnnounceResolver.resolve(input);
    if (input.event.category === "SESSION") return sessionAnnounceResolver.resolve(input);
    if (input.event.category === "TOURNAMENT") return tournamentAnnounceResolver.resolve(input);
    if (input.event.category === "ACHIEVEMENT" && TOWER_STEAM_EVENT_TYPES.includes(input.event.eventType)) return towerSteamAnnounceResolver.resolve(input);
    if (input.event.category === "INSTANT_SESSION") return instantSessionInviteResolver.resolve(input);
    if (input.event.category === "ROULETTE") return rouletteDmResolver.resolve(input);
    if (input.event.category === "REWARD") return communitySystemAnnounceResolver.resolve(input);
    if (input.event.category === "ADMIN" && input.event.eventType === TEAM_SPACE_EVENT) return teamSpaceSyncResolver.resolve(input);
    if (input.event.category === "ADMIN" && input.event.eventType === MODERATION_REPORT_EVENT) return reportTicketResolver.resolve(input);
    if (input.event.category === "ADMIN" && input.event.eventType === PROJECT_SYNC_EVENT) return projectSyncResolver.resolve(input);
    if (input.event.category === "ADMIN" && input.event.eventType === ROLE_AUTOCREATE_EVENT) return roleCreationResolver.resolve(input);
    if (input.event.category === "ADMIN" && input.event.eventType === TOURNAMENT_TEAM_NOTIFY) return teamTournamentNoticeResolver.resolve(input);
    if (input.event.category === "ADMIN" && input.event.eventType === SESSION_SPACE_EVENT) return sessionSpaceSyncResolver.resolve(input);
    if (input.event.category === "ADMIN" && input.event.eventType === TEAM_APPLICATION_NOTIFY) return teamApplicationNoticeResolver.resolve(input);
    if (input.event.category === "ADMIN") return onboardingReminderResolver.resolve(input);
    return NOT_CONFIGURED_RESOLVER.resolve(input);
  },
  // MP des soirées (V2) — sans ce relais, la mention de secours d'un MP
  // fermé ne serait jamais mise en file (le hook vit sur le résolveur SESSION).
  async onTerminalDiscordFailure(input) {
    if (input.event.category === "SESSION") await sessionAnnounceResolver.onTerminalDiscordFailure?.(input);
    // MP des tournois (V2) — mention de secours dans le fil. La roulette n'a
    // pas de fil : un MP fermé y est seulement tracé (aucun hook).
    if (input.event.category === "TOURNAMENT") await tournamentAnnounceResolver.onTerminalDiscordFailure?.(input);
  },
};
