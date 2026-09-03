import { prisma } from "@/lib/prisma";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { createNotification } from "@/lib/notifications";
import { checkPronosticBadges } from "@/lib/badges";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { getWinningProposalParticipants } from "@/lib/superlative-voting";
import { logger } from "@/lib/logger";

/**
 * Sprint 4 (FEATURE 1, Pronostics) — participants éligibles à prédire "qui
 * va carry" pour une session `SCHEDULED` : mêmes users que ceux qui
 * participeront au vote de superlatifs une fois la soirée `DONE` (même
 * définition de "présence" que partout ailleurs dans le chantier — voteurs
 * de la proposition gagnante). Utilisée par la page pour lister qui peut
 * pronostiquer, et par qui.
 */
export async function getPronosticEligibleUsers(
  sessionId: string,
  decidedGameId: string
) {
  return getWinningProposalParticipants(sessionId, decidedGameId);
}

/**
 * Enregistre le prono d'un voteur — 1 par personne et par soirée
 * (`@@unique([sessionId, voterId])`, retombe silencieusement en cas de
 * doublon, pas de ré-écriture possible une fois posé : même philosophie
 * "append-only" que `submitSuperlativeVotesAction`, un prono modifiable
 * après coup n'aurait plus de valeur prédictive).
 */
export async function submitPronostic(
  sessionId: string,
  voterId: string,
  predictedUserId: string
): Promise<boolean> {
  try {
    await prisma.pronostic.create({
      data: { sessionId, voterId, predictedUserId },
    });
    return true;
  } catch {
    // Contrainte unique : déjà pronostiqué pour cette soirée, on ignore.
    return false;
  }
}

/**
 * Résout tous les pronos d'une session dès que les superlatifs sont
 * clôturés (appelée depuis `finalizeSuperlativeVoting`,
 * src/lib/superlative-voting.ts, dans ses 3 branches de sortie — y compris
 * "0 award" : dans ce cas `carryMvpWinnerIds` est vide, tous les pronos en
 * attente sont simplement marqués incorrects). Idempotent par construction
 * (chaque session n'est finalisée qu'une fois, `superlativeVotingClosed`
 * empêche un second passage) donc pas de garde supplémentaire ici.
 */
export async function resolvePronostics(
  sessionId: string,
  carryMvpWinnerIds: Set<string>
): Promise<void> {
  const pronostics = await prisma.pronostic.findMany({
    where: { sessionId },
    include: { voter: true, predictedUser: true },
  });

  for (const pronostic of pronostics) {
    const correct = carryMvpWinnerIds.has(pronostic.predictedUserId);
    await prisma.pronostic.update({
      where: { id: pronostic.id },
      data: { correct },
    });
    if (!correct) continue;

    await awardXp(
      pronostic.voterId,
      "PRONOSTIC_CORRECT",
      pronostic.id,
      XP_AMOUNTS.PRONOSTIC_CORRECT
    );
    await checkPronosticBadges(pronostic.voterId);

    await createNotification({
      userId: pronostic.voterId,
      type: "PRONOSTIC",
      title: "🔮 Pronostic correct !",
      message: `Tu avais prédit juste pour ${pronostic.predictedUser.discordName} — +${XP_AMOUNTS.PRONOSTIC_CORRECT} XP`,
      relatedSessionId: sessionId,
    });

    // Notif Discord (spec) — embed direct, pas de passage par
    // `MessageTemplate` : le texte est fixe et déjà entièrement spécifié,
    // même choix que les autres notifs "personnelles" à un seul user (cf.
    // `discord-level-up.ts`/`discord-badge-unlocked.ts` pour le pendant
    // MessageTemplate, ici volontairement plus léger).
    const result = await postToDiscord({
      title: "🔮 Pronostic correct !",
      description: `<@${pronostic.voter.discordId}> avait prédit juste — +${XP_AMOUNTS.PRONOSTIC_CORRECT} XP`,
      color: ACCENT_COLOR,
    });
    if (!result.ok) {
      logger.warn("pronostics", "Notif Discord pronostic correct non envoyée.", {
        pronosticId: pronostic.id,
      });
    }
  }
}
