import { prisma } from "@/lib/prisma";
import { WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY, type PostToDiscordResult } from "@/lib/discord";
import { formatReminderTimingShort } from "@/lib/reminder-timings";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { createNotifications } from "@/lib/notifications";
import type { Game, Session } from "@prisma/client";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { logger } from "@/lib/logger";

/**
 * Chantier confidentialité des soirées — voir le commentaire de fonction
 * de `announceSessionResult` (discord-announce.ts) pour le raisonnement
 * complet : ce chemin webhook (sessions `announceViaBot: false`) n'a
 * aucun mécanisme privé équivalent, le POST Discord public (embed +
 * mentions des joueurs) est désormais TOUJOURS supprimé. Les
 * notifications INTERNES restent envoyées, EN PLUS restreintes aux
 * invités encore ACTIFS (`filterByActiveSessionInvite`) — même garantie
 * que les autres chemins de ce chantier.
 *
 * Fix bug remonté (rappels de rattrapage au contenu mensonger) :
 * `actualMinutesRemaining` est le temps RÉELLEMENT restant avant la
 * soirée (calculé par `computeTimingsDue`, `reminders.ts`), jamais le
 * seuil configuré tel quel — ce chemin est appelé de façon SYNCHRONE
 * juste après ce calcul (même passage de cron, aucun délai de file
 * d'attente contrairement au chemin bot), donc aucun recalcul
 * supplémentaire n'est nécessaire ici pour rester exact.
 */
export async function sendSessionReminder(
  session: Session & { decidedGame: Game | null },
  actualMinutesRemaining: number
): Promise<PostToDiscordResult> {
  if (!session.decidedGame) {
    return { ok: false, error: "pas_de_jeu_decide" };
  }

  const proposal = await prisma.proposal.findUnique({
    where: {
      sessionId_gameId: { sessionId: session.id, gameId: session.decidedGame.id },
    },
    include: { votes: { include: { user: true } } },
  });

  const notifiedUserIds = resolveNotifiedUserIds(session.notifiedUserIds);
  const selectedPlayers = (proposal?.votes ?? [])
    .map((v) => v.user)
    .filter((u) => !notifiedUserIds || notifiedUserIds.includes(u.id));
  const eligibleByPreference = await filterUsersByNotificationPreference(selectedPlayers, "SESSION");
  const players = await filterByActiveSessionInvite(session.id, session.createdById, eligibleByPreference);

  // Notifications in-app (Sprint 2 PR-C, U3) — mêmes destinataires que
  // les mentions qu'aurait portées l'ancien message Discord, EN PLUS
  // restreintes aux invités encore actifs.
  await createNotifications(
    players.map((u) => ({
      userId: u.id,
      type: "REMINDER" as const,
      title: `⏰ Rappel — dans ${formatReminderTimingShort(actualMinutesRemaining)} !`,
      message: session.decidedGame!.name,
      relatedSessionId: session.id,
    }))
  );

  logger.info(
    "discord-reminder",
    "Rappel webhook SUPPRIMÉ (confidentialité des soirées — salon public, aucun mécanisme privé pour ce chemin legacy)."
  );
  return { ok: false, error: WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY };
}
