import { prisma } from "@/lib/prisma";
import {
  postToDiscord,
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { pickMessageTemplate } from "@/lib/message-templates";
import { formatDateTimeFr, toTimeInputValue } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { createNotifications } from "@/lib/notifications";
import type { Session, User } from "@prisma/client";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";

function absoluteSessionUrl(sessionId: string): string {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/sessions/${sessionId}`;
}

/**
 * Notifie Discord à la création d'une soirée (Chantier C — le manque le
 * plus remonté à l'usage : jusqu'ici, aucune notif au moment où une
 * session apparaît). Deux parties dans le message :
 * - un texte "hype" tiré au hasard dans `MessageTemplate` (catégorie
 *   `SESSION_CREATED`) mis dans le `content` brut du webhook — seul canal
 *   qui déclenche une vraie notification push Discord (même détail que
 *   F6/F7) ;
 * - un embed structuré (titre, date/heure, deadline de vote, lien absolu
 *   vers la page de la session, construit depuis `AUTH_URL`).
 *
 * Ping de tout le groupe (choix assumé : mentions individuelles de
 * chaque membre plutôt que `@everyone` — cohérent avec F6/F7 qui ne
 * mentionnent jamais `@everyone`, et évite une notif silencieusement
 * ratée si le webhook n'a pas la permission "Mentionner @everyone" sur
 * le salon). Le créateur n'est pas mentionné (il vient de cliquer le
 * bouton), et les utilisateurs en silence (`User.silenceReminders`) ne
 * le sont pas non plus, par cohérence avec le reste de l'app. Dégrade
 * proprement sans `DISCORD_WEBHOOK_URL` (cf. F6/F7) : `postToDiscord` ne
 * lève jamais, la création de la session n'est jamais bloquée par un
 * souci d'envoi Discord.
 *
 * Ping sélectif : `session.notifiedUserIds` restreint en plus ce ping de
 * groupe à la sélection faite par le créateur au formulaire
 * (`null` = pas de restriction, comportement ci-dessus inchangé).
 */
export async function announceSessionCreated(
  session: Pick<Session, "id" | "date" | "votingDeadline" | "notifiedUserIds">,
  creator: Pick<User, "id" | "discordId">
): Promise<PostToDiscordResult> {
  const vars = {
    heure: toTimeInputValue(session.date),
    date: formatDateTimeFr(session.date),
    createur: `<@${creator.discordId}>`,
  };

  const message = await pickMessageTemplate("SESSION_CREATED", vars);

  const notifiedUserIds = resolveNotifiedUserIds(session.notifiedUserIds);
  const candidates = await prisma.user.findMany({
    where: {
      id: { not: creator.id, ...(notifiedUserIds ? { in: notifiedUserIds } : {}) },
    },
  });
  const others = await filterUsersByNotificationPreference(candidates, "SESSION");
  const mentions = others.map((u) => `<@${u.discordId}>`);

  // Notifications in-app (Sprint 2 PR-C, U3) — mêmes destinataires que
  // les mentions Discord ci-dessus (déjà filtrées par `notifiedUserIds`
  // et `silenceReminders`).
  await createNotifications(
    others.map((u) => ({
      userId: u.id,
      type: "SESSION_CREATED" as const,
      title: "📣 Nouvelle soirée",
      message: vars.date,
      relatedSessionId: session.id,
    }))
  );

  const embed: DiscordEmbed = {
    title: "📣 Nouvelle soirée",
    description: vars.date,
    color: ACCENT_COLOR,
    fields: [
      // Fix UX (remonté en prod) : le créateur n'était visible que noyé
      // dans le texte "hype" tiré au hasard, pas toujours présent selon le
      // message pioché. Champ dédié, toujours affiché — `<@discordId>`
      // dans un champ d'embed s'affiche comme une mention cliquable sans
      // déclencher de notification push (contrairement au même ping en
      // `content`), donc pas de double-ping du créateur.
      { name: "Créée par", value: vars.createur, inline: true },
      {
        name: "Deadline de vote",
        value: formatDateTimeFr(session.votingDeadline ?? session.date),
        inline: true,
      },
      { name: "Lien", value: absoluteSessionUrl(session.id) },
    ],
  };

  const content = [message, mentions.join(" ")].filter(Boolean).join("\n\n");

  return postToDiscord(embed, content || undefined);
}
