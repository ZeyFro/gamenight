import { prisma } from "@/lib/prisma";
import {
  postToDiscord,
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
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

const FALLBACK_TEMPLATE =
  "🎮 Rappel : {jeu} à {heure} ! {pote}";

function substituteVariables(
  template: string,
  vars: { pote: string; jeu: string; heure: string }
): string {
  return template
    .replaceAll("{pote}", vars.pote)
    .replaceAll("{jeu}", vars.jeu)
    .replaceAll("{heure}", vars.heure);
}

async function pickMessage(
  session: Pick<Session, "customReminderMessage">,
  vars: { pote: string; jeu: string; heure: string }
): Promise<string> {
  if (session.customReminderMessage) {
    return substituteVariables(session.customReminderMessage, vars);
  }

  const templates = await prisma.reminderTemplate.findMany({
    where: { active: true },
  });
  if (templates.length === 0) {
    return substituteVariables(FALLBACK_TEMPLATE, vars);
  }

  const pick = templates[Math.floor(Math.random() * templates.length)];
  return substituteVariables(pick.text, vars);
}

/**
 * Envoie le rappel Discord d'une session pour une fenêtre donnée (24h ou
 * 2h avant). Message = celui perso de la session s'il est renseigné,
 * sinon un tirage aléatoire parmi les `ReminderTemplate` actifs (repli
 * générique si la liste est vide — ne devrait pas arriver une fois le
 * seed initial en place). Les joueurs en silence (`User.silenceReminders`)
 * ne sont jamais mentionnés — ni dans `{pote}`, ni dans le `content` brut
 * du message (seul canal qui déclenche une vraie notification push,
 * cf. F6) — mais le message est posté dans tous les cas.
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

  const message = await pickMessage(session, vars);

  const embed: DiscordEmbed = {
    title: WINDOW_TITLES[window],
    description: message,
    color: ACCENT_COLOR,
    fields: [{ name: "Heure", value: vars.heure, inline: true }],
  };

  return postToDiscord(embed, mentions.length > 0 ? mentions.join(" ") : undefined);
}
