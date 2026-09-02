import { prisma } from "@/lib/prisma";
import { createNotifications, type CreateNotificationInput } from "@/lib/notifications";

const REVANCHE_THRESHOLD = 3;

/**
 * Revanche auto (Sprint 3, FEATURE 3) — dérivé des `SessionResult`
 * existants, aucune nouvelle table. Appelé juste après l'enregistrement
 * des résultats d'une soirée (`submitSessionResultsAction`) : pour chaque
 * participant de CETTE session qui vient d'atteindre exactement sa 3e
 * participation à ce jeu sans jamais avoir été 1er, notifie le reste du
 * groupe (jamais le participant concerné lui-même — l'app propose SA
 * revanche aux autres, pas à lui-même) avec un lien "Proposer" qui
 * préremplit la création de soirée avec ce jeu.
 *
 * Ne s'applique qu'aux jeux compétitifs (`Game.isCoop = false`) : un jeu
 * coop n'a pas de notion de "gagner" dans ce modèle de données
 * (`SessionResult.placement` reste toujours `null` en coop, cf.
 * `submitSessionResultsAction`).
 *
 * Se déclenche une seule fois par (user, jeu) — exactement au moment où
 * l'historique atteint `REVANCHE_THRESHOLD` sans victoire — jamais aux
 * participations suivantes, pour ne pas répéter indéfiniment la même
 * suggestion à chaque nouvelle défaite sur ce jeu.
 */
export async function checkRevancheAfterSessionResults(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      decidedGame: { select: { id: true, name: true, isCoop: true } },
      results: { select: { userId: true } },
    },
  });
  if (!session?.decidedGame || session.decidedGame.isCoop) return;
  const game = session.decidedGame;

  const notifications: CreateNotificationInput[] = [];

  for (const { userId } of session.results) {
    const history = await prisma.sessionResult.findMany({
      where: { userId, session: { decidedGameId: game.id, status: "DONE" } },
      select: { placement: true },
    });
    if (history.length !== REVANCHE_THRESHOLD) continue;
    const everWon = history.some((h) => h.placement === 1);
    if (everWon) continue;

    const pote = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordName: true },
    });
    if (!pote) continue;

    const others = await prisma.user.findMany({
      where: { id: { not: userId } },
      select: { id: true },
    });
    for (const { id: otherId } of others) {
      notifications.push({
        userId: otherId,
        type: "REVANCHE",
        title: "🔄 Revanche possible",
        message: `${pote.discordName} n'a jamais gagné à ${game.name} en ${REVANCHE_THRESHOLD} parties — proposer une revanche ?`,
        relatedGameId: game.id,
      });
    }
  }

  if (notifications.length > 0) await createNotifications(notifications);
}
