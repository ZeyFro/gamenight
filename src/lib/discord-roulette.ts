import { prisma } from "@/lib/prisma";
import {
  postToDiscord,
  ACCENT_COLOR,
  DESTRUCTIVE_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { formatDateTimeFr } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { createNotifications } from "@/lib/notifications";
import type { Roulette, User } from "@prisma/client";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";

function absoluteRouletteUrl(rouletteId: string): string {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/roulette/${rouletteId}`;
}

/**
 * Roulette async (Sprint 3) — pas de `MessageTemplate` pour ces 3
 * annonces (contrairement à F6/F7) : contenu fixe, même choix que
 * `announceSessionResult` (déjà 100% embed structuré, sans tirage
 * aléatoire de texte "hype"). Ajouter une nouvelle catégorie de message
 * personnalisable pour une fonctionnalité annexe n'était pas justifié ici.
 */
export async function announceRouletteCreated(
  roulette: Pick<Roulette, "id" | "scheduledAt" | "deadline" | "notifiedUserIds">,
  creator: Pick<User, "id" | "discordId">
): Promise<PostToDiscordResult> {
  const notifiedUserIds = resolveNotifiedUserIds(roulette.notifiedUserIds) ?? [];
  const candidates = await prisma.user.findMany({
    where: { id: { in: notifiedUserIds, not: creator.id } },
  });
  const others = await filterUsersByNotificationPreference(candidates, "ROULETTE");
  const mentions = others.map((u) => `<@${u.discordId}>`);

  await createNotifications(
    others.map((u) => ({
      userId: u.id,
      type: "SESSION_CREATED" as const,
      title: "🎰 Roulette du gambling",
      message: `Propose tes 2 jeux avant ${formatDateTimeFr(roulette.deadline)}`,
    }))
  );

  const embed: DiscordEmbed = {
    title: "🎰 ROULETTE DU GAMBLING !",
    description: `Chacun propose ses 2 jeux avant **${formatDateTimeFr(roulette.deadline)}**. La roue tourne à **${formatDateTimeFr(roulette.scheduledAt)}**.`,
    color: ACCENT_COLOR,
    fields: [{ name: "Lien", value: absoluteRouletteUrl(roulette.id) }],
  };

  const content = mentions.join(" ");
  return postToDiscord(embed, content || undefined);
}

/** Rappel — participants qui n'ont pas encore proposé leurs 2 jeux, 1h avant la deadline. */
export async function announceRouletteReminder(
  roulette: Pick<Roulette, "id" | "deadline">,
  missingUserIds: string[]
): Promise<PostToDiscordResult> {
  const candidates = await prisma.user.findMany({
    where: { id: { in: missingUserIds } },
  });
  const missing = await filterUsersByNotificationPreference(candidates, "ROULETTE");
  const mentions = missing.map((u) => `<@${u.discordId}>`);

  const embed: DiscordEmbed = {
    title: "⏰ Roulette — dernière ligne droite",
    description: `Plus qu'1h pour proposer tes 2 jeux ! Deadline : **${formatDateTimeFr(roulette.deadline)}**.`,
    color: ACCENT_COLOR,
    fields: [{ name: "Lien", value: absoluteRouletteUrl(roulette.id) }],
  };

  // Le refus retire la sollicitation personnelle, jamais l'annonce
  // collective du salon — même si plus personne ne peut être mentionné.
  return postToDiscord(embed, mentions.length > 0 ? mentions.join(" ") : undefined);
}

/** Résultat du tirage — mêmes destinataires que les votants créés (`RouletteEntry` distinctes). */
export async function announceRouletteResult(
  roulette: Pick<Roulette, "id" | "scheduledAt">,
  gameName: string,
  gameCoverUrl: string | null,
  winnerUserIds: string[],
  sessionId: string
): Promise<PostToDiscordResult> {
  const candidates = await prisma.user.findMany({
    where: { id: { in: winnerUserIds } },
  });
  const winners = await filterUsersByNotificationPreference(candidates, "ROULETTE");
  const mentions = winners.map((u) => `<@${u.discordId}>`);

  await createNotifications(
    winners.map((u) => ({
      userId: u.id,
      type: "SESSION_RESULT" as const,
      title: `🎰 La roue a choisi : ${gameName}`,
      message: formatDateTimeFr(roulette.scheduledAt),
      relatedSessionId: sessionId,
    }))
  );

  const embed: DiscordEmbed = {
    title: `🎰 La roue a choisi : ${gameName} !`,
    description: `Soirée ${formatDateTimeFr(roulette.scheduledAt)}`,
    color: ACCENT_COLOR,
    thumbnail: gameCoverUrl ? { url: gameCoverUrl } : undefined,
  };

  return postToDiscord(embed, mentions.length > 0 ? mentions.join(" ") : undefined);
}

/** Annulation silencieuse (moins de 2 participants) — même philosophie que "0 votant" sur une session classique : embed posté (contrairement au cas session), mais pas de mention individuelle. */
export async function announceRouletteCancelled(
  roulette: Pick<Roulette, "scheduledAt">
): Promise<PostToDiscordResult> {
  const embed: DiscordEmbed = {
    title: "❌ Roulette annulée",
    description: `Pas assez de participants pour la roulette du ${formatDateTimeFr(roulette.scheduledAt)}.`,
    color: DESTRUCTIVE_COLOR,
  };
  return postToDiscord(embed);
}
