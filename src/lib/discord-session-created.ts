import { prisma } from "@/lib/prisma";
import { WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY, type PostToDiscordResult } from "@/lib/discord";
import { formatDateTimeFr } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { createNotifications } from "@/lib/notifications";
import type { Session, User } from "@prisma/client";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { logger } from "@/lib/logger";
import { getDefaultCommunityId } from "@/lib/default-community";

/**
 * Chantier confidentialité des soirées — voir le commentaire de fonction
 * de `announceSessionResult` (discord-announce.ts) pour le raisonnement
 * complet : ce chemin webhook n'a aucun mécanisme privé, le POST Discord
 * public (et la construction de son embed) est désormais TOUJOURS
 * supprimé pour une soirée créée sur ce chemin. Seules les notifications
 * internes (in-app, déjà protégées par src/lib/session-access.ts)
 * continuent d'être écrites, restreintes aux invités ACTIFS.
 */
export async function announceSessionCreated(
  session: Pick<Session, "id" | "createdById" | "date" | "votingDeadline" | "notifiedUserIds" | "communityId">,
  creator: Pick<User, "id" | "discordId">
): Promise<PostToDiscordResult> {
  const notifiedUserIds = resolveNotifiedUserIds(session.notifiedUserIds);
  const candidates = await prisma.user.findMany({
    where: {
      id: { not: creator.id, ...(notifiedUserIds ? { in: notifiedUserIds } : {}) },
    },
  });
  const eligibleByPreference = await filterUsersByNotificationPreference(candidates, "SESSION");
  const others = await filterByActiveSessionInvite(session.id, session.createdById, eligibleByPreference);

  // Notifications in-app (Sprint 2 PR-C, U3) — mêmes destinataires que
  // les mentions qu'aurait portées l'ancien message Discord, EN PLUS
  // restreintes aux invités encore actifs. Provenance déjà connue : même
  // règle que `createNotifications` (soirée historique null = default),
  // sans relire la soirée.
  const communityId = session.communityId ?? (others.length ? await getDefaultCommunityId() : null);
  await createNotifications(
    others.map((u) => ({
      communityId,
      userId: u.id,
      type: "SESSION_CREATED" as const,
      title: "📣 Nouvelle soirée",
      message: formatDateTimeFr(session.date),
      relatedSessionId: session.id,
    }))
  );

  logger.info(
    "discord-session-created",
    "Annonce webhook de création de soirée SUPPRIMÉE (confidentialité des soirées — salon public, aucun mécanisme privé pour ce chemin legacy)."
  );
  return { ok: false, error: WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY };
}
