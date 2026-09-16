import { prisma } from "@/lib/prisma";
import {
  postToDiscord,
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { pickMessageTemplate } from "@/lib/message-templates";
import { formatDateTimeFr, toTimeInputValue } from "@/lib/wallclock";
import type { Session, User } from "@prisma/client";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";

function absoluteSessionUrl(sessionId: string): string {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/sessions/${sessionId}`;
}

/**
 * Notifie Discord quand le créateur modifie la date/heure/deadline d'une
 * soirée (PR 3/3 — pendant de `announceSessionCreated` pour l'édition).
 * Deux différences volontaires avec la notif de création :
 * - **Ping ciblé, pas tout le groupe** : seuls les membres ayant déjà voté
 *   sur une proposition de cette session sont mentionnés (respect de
 *   `silenceReminders`) — ce sont eux qui ont un intérêt direct à savoir
 *   que le créneau a bougé, contrairement à quelqu'un qui n'a pas encore
 *   voté et découvrira le nouveau créneau normalement en votant.
 * - **Embed avec ancien vs nouveau créneau** : l'ancien est barré
 *   (markdown Discord `~~texte~~`, supporté dans les champs d'embed) pour
 *   qu'on voie l'écart en un coup d'œil, plutôt qu'un simple horodatage
 *   "dernière modif".
 */
export async function announceSessionModified(
  session: Pick<Session, "id" | "date" | "votingDeadline">,
  previous: Pick<Session, "date" | "votingDeadline">,
  editor: Pick<User, "id" | "discordId">
): Promise<PostToDiscordResult> {
  const vars = {
    heure: toTimeInputValue(session.date),
    date: formatDateTimeFr(session.date),
    createur: `<@${editor.discordId}>`,
    ancienne_heure: toTimeInputValue(previous.date),
    ancienne_date: formatDateTimeFr(previous.date),
  };

  const message = await pickMessageTemplate("SESSION_MODIFIED", vars);

  const candidates = await prisma.user.findMany({
    where: {
      id: { not: editor.id },
      votes: { some: { proposal: { sessionId: session.id } } },
    },
  });
  const voters = await filterUsersByNotificationPreference(candidates, "SESSION");
  const mentions = voters.map((u) => `<@${u.discordId}>`);

  const embed: DiscordEmbed = {
    title: "⚠️ Soirée modifiée",
    description: vars.date,
    color: ACCENT_COLOR,
    fields: [
      { name: "Ancien créneau", value: `~~${vars.ancienne_date}~~`, inline: true },
      { name: "Nouveau créneau", value: vars.date, inline: true },
      {
        name: "Deadline de vote",
        value: formatDateTimeFr(session.votingDeadline ?? session.date),
      },
      { name: "Lien", value: absoluteSessionUrl(session.id) },
    ],
  };

  const content = [message, mentions.join(" ")].filter(Boolean).join("\n\n");

  return postToDiscord(embed, content || undefined);
}
