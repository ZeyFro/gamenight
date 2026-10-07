import { prisma } from "@/lib/prisma";
import { createNotifications, type CreateNotificationInput } from "@/lib/notifications";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { statsCommunityIdForSession } from "@/lib/community-stats";

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
      communityId: true,
      decidedGame: { select: { id: true, name: true, isCoop: true } },
      results: { select: { userId: true } },
    },
  });
  if (!session?.decidedGame || session.decidedGame.isCoop) return;
  const communityId = await statsCommunityIdForSession(session.communityId);
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { status: true } });
  if (community?.status !== "ACTIVE") return;
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const game = session.decidedGame;

  const notifications: CreateNotificationInput[] = [];

  for (const { userId } of session.results) {
    // Chantier nettoyage réel du stockage (V2, suite) — filtre sur
    // `SessionResult.gameId` (dénormalisé, survit à la purge de la
    // soirée), JAMAIS `session: {decidedGameId: ...}` : une relation
    // filter vers une soirée déjà purgée (`sessionId` devenu `null`) exclut
    // silencieusement la ligne, sous-comptant l'historique réel de défaites
    // consécutives à ce jeu — ce filtre resterait alors indéfiniment sous
    // le seuil `REVANCHE_THRESHOLD` malgré 3 défaites réelles. Toute ligne
    // `SessionResult` implique déjà une soirée `DONE` au moment de sa
    // création (`submitSessionResultsAction` le vérifie) — le filtre
    // `status: "DONE"` d'origine était donc redondant, jamais perdu ici.
    const history = await scopedDb.sessionResult.findMany({
      where: { userId, gameId: game.id },
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
      where: { id: { not: userId }, memberships: { some: { communityId, status: "ACTIVE", community: { status: "ACTIVE" } } } },
      select: { id: true },
    });
    for (const { id: otherId } of others) {
      notifications.push({
        userId: otherId,
        communityId,
        type: "REVANCHE",
        title: "🔄 Revanche possible",
        message: `${pote.discordName} n'a jamais gagné à ${game.name} en ${REVANCHE_THRESHOLD} parties — proposer une revanche ?`,
        relatedGameId: game.id,
      });
    }
  }

  if (notifications.length > 0) await createNotifications(notifications);
}
