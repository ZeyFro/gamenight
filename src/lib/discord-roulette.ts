import { prisma } from "@/lib/prisma";
import { WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY, type PostToDiscordResult } from "@/lib/discord";
import { formatDateTimeFr } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { createNotifications } from "@/lib/notifications";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { logger } from "@/lib/logger";
import type { Roulette, User } from "@prisma/client";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { enqueueRouletteDirectMessages } from "@/lib/roulette-dm";

/**
 * Chantier confidentialité des soirées — voir le commentaire de fonction
 * de `announceSessionResult` (discord-announce.ts) pour le raisonnement
 * complet, applicable ici à l'identique : `DISCORD_WEBHOOK_URL` pointe un
 * salon PUBLIC, sans mécanisme privé équivalent. TOUTES les annonces
 * webhook de roulette ci-dessous sont désormais des no-op réseau —
 * `announceRouletteCreated`/`announceRouletteReminder`/`announceRouletteCancelled`
 * concernent la roulette ELLE-MÊME (avant tout tirage, donc avant toute
 * `Session`/`SessionInvite`) : leur audience reste `Roulette.notifiedUserIds`
 * (seule source d'invitation existante à ce stade, voir `/roulette/page.tsx`
 * et `/roulette/[id]/page.tsx`, gated dessus) — inchangée. `announceRouletteResult`
 * concerne en revanche une VRAIE `Session` déjà créée
 * (`createRouletteResultSession`) : ses notifications internes sont donc
 * EN PLUS restreintes aux invités `SessionInvite` encore ACTIFS, même
 * garantie que le reste de ce chantier.
 *
 * Portée assumée, DIFFÉRENTE de "la refonte complète Soirée → Roulette"
 * (explicitement hors de ce chantier) : une roulette encore OUVERTE
 * (avant tirage) n'a donc plus AUCUNE annonce Discord du tout tant
 * qu'aucun mécanisme privé dédié (fil privé par roulette, membership
 * synchronisée) n'existe pour elle — documenté comme point ouvert dans le
 * README.
 */
function skippedByPrivacy(context: string): PostToDiscordResult {
  logger.info(
    "discord-roulette",
    `Annonce webhook ${context} SUPPRIMÉE (confidentialité des soirées — salon public, aucun mécanisme privé pour ce chemin legacy).`
  );
  return { ok: false, error: WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY };
}

export async function announceRouletteCreated(
  roulette: Pick<Roulette, "id" | "scheduledAt" | "deadline" | "notifiedUserIds">,
  creator: Pick<User, "id" | "discordId">
): Promise<PostToDiscordResult> {
  const notifiedUserIds = resolveNotifiedUserIds(roulette.notifiedUserIds) ?? [];
  const candidates = await prisma.user.findMany({
    where: { id: { in: notifiedUserIds, not: creator.id } },
  });
  const others = await filterUsersByNotificationPreference(candidates, "ROULETTE");

  await createNotifications(
    others.map((u) => ({
      userId: u.id,
      type: "SESSION_CREATED" as const,
      title: "🎰 Roulette du gambling",
      message: `Propose tes 2 jeux avant ${formatDateTimeFr(roulette.deadline)}`,
    }))
  );

  // MP (V2) — participants ET créateur, si DISCORD_DM_ROULETTE_ENABLED.
  await enqueueRouletteDirectMessages(roulette.id, "created", [...notifiedUserIds, creator.id]);

  return skippedByPrivacy("de création de roulette");
}

/** Rappel — participants qui n'ont pas encore proposé leurs 2 jeux, 1h avant la deadline. */
export async function announceRouletteReminder(
  roulette: Pick<Roulette, "id" | "deadline">,
  missingUserIds: string[]
): Promise<PostToDiscordResult> {
  // MP (V2) — seulement ceux qui n'ont pas encore proposé leurs 2 jeux
  // (créateur inclus s'il en fait partie).
  await enqueueRouletteDirectMessages(roulette.id, "reminder", missingUserIds);
  return skippedByPrivacy("de rappel de roulette");
}

/** Résultat du tirage — mêmes destinataires que les votants créés (`RouletteEntry` distinctes), EN PLUS restreints aux invités `SessionInvite` encore actifs sur la session résultante. */
export async function announceRouletteResult(
  roulette: Pick<Roulette, "id" | "scheduledAt">,
  gameName: string,
  gameCoverUrl: string | null,
  winnerUserIds: string[],
  sessionId: string
): Promise<PostToDiscordResult> {
  void gameCoverUrl;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { createdById: true } });

  const candidates = await prisma.user.findMany({
    where: { id: { in: winnerUserIds } },
  });
  const eligibleByPreference = await filterUsersByNotificationPreference(candidates, "ROULETTE");
  const winners = session
    ? await filterByActiveSessionInvite(sessionId, session.createdById, eligibleByPreference)
    : eligibleByPreference;

  await createNotifications(
    winners.map((u) => ({
      userId: u.id,
      type: "SESSION_RESULT" as const,
      title: `🎰 La roue a choisi : ${gameName}`,
      message: formatDateTimeFr(roulette.scheduledAt),
      relatedSessionId: sessionId,
    }))
  );

  // Plus de MP de résultat : à la fin d'une roulette (tirage ou annulation),
  // `spinRoulette` ÉDITE le MP d'invitation déjà envoyé
  // (`enqueueRouletteDirectMessageEdits`), jamais un nouveau MP.

  return skippedByPrivacy("de résultat de roulette");
}

/** Annulation silencieuse (moins de 2 participants). */
export async function announceRouletteCancelled(
  roulette: Pick<Roulette, "scheduledAt">
): Promise<PostToDiscordResult> {
  void roulette;
  return skippedByPrivacy("d'annulation de roulette");
}
