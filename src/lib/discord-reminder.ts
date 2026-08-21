import { prisma } from "@/lib/prisma";
import {
  postToDiscord,
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { pickMessageTemplate, substituteVariables } from "@/lib/message-templates";
import { toTimeInputValue } from "@/lib/wallclock";
import type { Game, Session } from "@prisma/client";

export type ReminderWindow = "24h" | "2h";

export const REMINDER_WINDOW_HOURS: Record<ReminderWindow, number> = {
  "24h": 24,
  "2h": 2,
};

const WINDOW_TITLES: Record<ReminderWindow, string> = {
  "24h": "⏰ Rappel — dans 24h !",
  "2h": "⏰ Rappel — dans 2h !",
};

const WINDOW_CATEGORY = {
  "24h": "REMINDER_24H",
  "2h": "REMINDER_2H",
} as const;

/**
 * Envoie le rappel Discord d'une session pour une fenêtre donnée (24h ou
 * 2h avant). Message = celui perso de la session s'il est renseigné,
 * sinon un tirage aléatoire parmi les `MessageTemplate` actifs de la
 * catégorie `REMINDER_24H`/`REMINDER_2H` (via `pickMessageTemplate`, avec
 * repli générique si la liste est vide — comportement F7 inchangé, malgré
 * le renommage `ReminderTemplate` → `MessageTemplate`). Les joueurs en
 * silence (`User.silenceReminders`) ne sont jamais mentionnés — ni dans
 * `{pote}`, ni dans le `content` brut du message (seul canal qui
 * déclenche une vraie notification push, cf. F6) — mais le message est
 * posté dans tous les cas.
 */
export async function sendSessionReminder(
  session: Session & { decidedGame: Game | null },
  window: ReminderWindow
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

  const players = (proposal?.votes ?? [])
    .map((v) => v.user)
    .filter((u) => !u.silenceReminders);
  const mentions = players.map((u) => `<@${u.discordId}>`);

  const vars = {
    pote: mentions.join(" "),
    jeu: session.decidedGame.name,
    heure: toTimeInputValue(session.date),
  };

  const message = session.customReminderMessage
    ? substituteVariables(session.customReminderMessage, vars)
    : await pickMessageTemplate(WINDOW_CATEGORY[window], vars);

  const embed: DiscordEmbed = {
    title: WINDOW_TITLES[window],
    description: message,
    color: ACCENT_COLOR,
    fields: [{ name: "Heure", value: vars.heure, inline: true }],
  };

  return postToDiscord(embed, mentions.length > 0 ? mentions.join(" ") : undefined);
}
