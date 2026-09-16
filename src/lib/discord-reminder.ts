import { prisma } from "@/lib/prisma";
import {
  postToDiscord,
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { pickMessageTemplate, substituteVariables } from "@/lib/message-templates";
import { toTimeInputValue } from "@/lib/wallclock";
import { formatReminderTimingShort, isCloseReminder } from "@/lib/reminder-timings";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { createNotifications } from "@/lib/notifications";
import type { Game, Session } from "@prisma/client";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";

/**
 * Envoie le rappel Discord d'une session pour un timing donné (minutes
 * avant la session — `Session.reminderTimings`, configurable par le
 * créateur depuis PR 31/2·4, remplace les deux fenêtres 24h/2h fixées en
 * dur). Message = celui perso de la session s'il est renseigné, sinon un
 * tirage aléatoire parmi les `MessageTemplate` actifs — la catégorie
 * (`REMINDER_24H` "loin"/hype vs `REMINDER_2H` "proche"/urgent, seules
 * catégories existantes) est choisie via `isCloseReminder` : le schéma de
 * messages n'a que ces deux tons, un préréglage intermédiaire ou un
 * rappel custom doit donc être rattaché au plus proche des deux (voir
 * `src/lib/reminder-timings.ts`). Les joueurs en silence
 * (`User.silenceReminders`) ne sont jamais mentionnés — ni dans `{pote}`,
 * ni dans le `content` brut du message (seul canal qui déclenche une
 * vraie notification push, cf. F6) — mais le message est posté dans tous
 * les cas.
 *
 * Ping sélectif : `session.notifiedUserIds` (choisi à la création)
 * restreint en plus les votants ci-dessus à la sélection du créateur —
 * `null` = pas de restriction (comportement historique, tous les votants
 * mentionnés).
 */
export async function sendSessionReminder(
  session: Session & { decidedGame: Game | null },
  minutesBefore: number
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
  const players = await filterUsersByNotificationPreference(selectedPlayers, "SESSION");
  const mentions = players.map((u) => `<@${u.discordId}>`);

  // Notifications in-app (Sprint 2 PR-C, U3) — mêmes destinataires que
  // les mentions Discord ci-dessous (déjà filtrées par `silenceReminders`
  // et `notifiedUserIds`).
  await createNotifications(
    players.map((u) => ({
      userId: u.id,
      type: "REMINDER" as const,
      title: `⏰ Rappel — dans ${formatReminderTimingShort(minutesBefore)} !`,
      message: session.decidedGame!.name,
      relatedSessionId: session.id,
    }))
  );

  const vars = {
    pote: mentions.join(" "),
    jeu: session.decidedGame.name,
    heure: toTimeInputValue(session.date),
  };

  const category = isCloseReminder(minutesBefore) ? "REMINDER_2H" : "REMINDER_24H";
  const message = session.customReminderMessage
    ? substituteVariables(session.customReminderMessage, vars)
    : await pickMessageTemplate(category, vars);

  const embed: DiscordEmbed = {
    title: `⏰ Rappel — dans ${formatReminderTimingShort(minutesBefore)} !`,
    description: message,
    color: ACCENT_COLOR,
    fields: [{ name: "Heure", value: vars.heure, inline: true }],
  };

  return postToDiscord(embed, mentions.length > 0 ? mentions.join(" ") : undefined);
}
