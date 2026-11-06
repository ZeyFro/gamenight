import { getScopedPrisma } from "@/lib/community-scoped-client";
import { listActiveInstantSessions } from "@/lib/instant-sessions";
import { listPlayerClassifieds } from "@/lib/player-classifieds";
import { accessibleSessionWhereFor } from "@/lib/session-access";
import { groupTonightByGame, isTonightMessage, tonightSessionWindow } from "@/lib/tonight-rules";

/**
 * Tableau « Qui joue ce soir ? » pour `userId` dans `communityId` :
 * - joueurs dispo ce soir, par jeu (petites annonces au préfixe dédié,
 *   déjà filtrées par communauté, échéance et membres actifs) ;
 * - soirées planifiées de ce soir que l'utilisateur peut voir (créateur ou
 *   invité actif : jamais une soirée privée d'un autre) ;
 * - parties « Jouer maintenant » en cours (ouvertes à tout membre).
 * Lecture seule : aucun appel Discord, aucune notification.
 */
export async function getTonightBoard(userId: string, communityId: string, now: Date) {
  const { from, to } = tonightSessionWindow(now);
  const scopedDb = await getScopedPrisma(userId);
  const [listings, accessibleWhere, instantSessions] = await Promise.all([
    listPlayerClassifieds(userId, communityId, now),
    accessibleSessionWhereFor(userId),
    listActiveInstantSessions(userId),
  ]);
  const sessions = await scopedDb.session.findMany({
    where: {
      AND: [
        accessibleWhere,
        { communityId, status: { in: ["VOTING", "SCHEDULED"] }, date: { gte: from, lt: to } },
      ],
    },
    select: { id: true, date: true, status: true, decidedGame: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  const mine = listings.filter((l) => l.createdBy.id === userId && isTonightMessage(l.message));

  return {
    players: groupTonightByGame(listings),
    myGames: mine.map((l) => l.game.name),
    sessions,
    instantSessions: instantSessions.map((s) => ({
      id: s.id,
      game: s.game.name,
      createdBy: s.createdBy.discordName,
      present: s.presence.length,
    })),
  };
}
