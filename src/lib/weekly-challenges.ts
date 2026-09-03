import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { getWeekStart } from "@/lib/calendar-dates";
import { getWinningProposalParticipants } from "@/lib/superlative-voting";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkChallengeBadges } from "@/lib/badges";
import type { WeeklyChallenge } from "@prisma/client";

/**
 * 15 défis hebdo fixes (Sprint 3 suite) — `type` fige un slug stable par
 * template ("T01".."T15") indépendant du texte, pour ne jamais perdre le
 * lien entre un `WeeklyChallenge` déjà en base et son template d'origine
 * si `description` est un jour retouché ici.
 */
const CHALLENGE_TEMPLATES: { type: string; description: string }[] = [
  { type: "T01", description: "Finir Minecraft en 1 soirée" },
  { type: "T02", description: "Faire un ace sur CS/Valorant (preuve screenshot)" },
  { type: "T03", description: "Commencer une soirée après 2h du mat" },
  { type: "T04", description: "Gagner 3 parties d'affilée sur le même jeu" },
  { type: "T05", description: "Jouer 5h non-stop sans pause" },
  { type: "T06", description: "Tout le monde joue un perso/agent jamais pris" },
  { type: "T07", description: "Gagner une game sans mourir (0 death)" },
  { type: "T08", description: "Le dernier du classement doit carry la game" },
  { type: "T09", description: "Jouer à un jeu que personne n'a jamais lancé" },
  { type: "T10", description: "Jouer uniquement avec un perso/arme random" },
  { type: "T11", description: "Faire une soirée avec TOUS les membres du groupe" },
  { type: "T12", description: "Battre son propre record sur n'importe quel jeu" },
  { type: "T13", description: "Jouer à un jeu sorti il y a plus de 10 ans" },
  { type: "T14", description: "Faire une soirée de speedrun" },
  {
    type: "T15",
    description: "Gagner en étant le joueur avec le moins de temps de jeu sur ce titre",
  },
];

/**
 * Défi de la semaine en cours — génération paresseuse au premier appel
 * de la semaine (pas de cron dédié) : si aucune ligne n'existe pour le
 * `weekStart` courant, une est créée en piochant un template au hasard.
 * `catch` sur la contrainte unique `@@unique([weekStart])` plutôt qu'un
 * verrou explicite : sous accès concurrents (deux chargements de Home en
 * même temps un lundi matin), un seul `create` gagne, l'autre retombe
 * simplement sur un `findUnique` — même mécanique d'idempotence que
 * `unlockBadge`.
 */
export async function getCurrentWeeklyChallenge(): Promise<WeeklyChallenge> {
  const weekStart = getWeekStart(wallClockNow());

  const existing = await prisma.weeklyChallenge.findUnique({ where: { weekStart } });
  if (existing) return existing;

  const template = CHALLENGE_TEMPLATES[Math.floor(Math.random() * CHALLENGE_TEMPLATES.length)];

  try {
    return await prisma.weeklyChallenge.create({
      data: { weekStart, type: template.type, description: template.description },
    });
  } catch {
    // Course perdue contre un autre appel concurrent — la ligne existe
    // forcément maintenant.
    return await prisma.weeklyChallenge.findUniqueOrThrow({ where: { weekStart } });
  }
}

/**
 * Complète le défi de la semaine EN COURS depuis une soirée `DONE` — la
 * session doit appartenir à cette même semaine calendaire (`session.date
 * >= weekStart`), pour qu'une vieille soirée ne puisse jamais cocher
 * rétroactivement le défi d'une semaine ultérieure. Réclame la
 * complétion atomiquement (`updateMany` conditionné sur `completedAt:
 * null`, même mécanique que `claimSessionClose`/`claimRouletteSpin`) :
 * seul le premier appel (le créateur qui clique) l'emporte.
 *
 * 100 XP à chaque participant réel de la soirée (mêmes voteurs de la
 * proposition gagnante que partout ailleurs dans le chantier), et check
 * du badge "Challenger" pour chacun.
 */
export async function completeWeeklyChallenge(
  sessionId: string
): Promise<{ completed: boolean; badgeUnlockedByUserId: Record<string, boolean> }> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, decidedGameId: true },
  });
  if (!session || session.status !== "DONE" || !session.decidedGameId) {
    return { completed: false, badgeUnlockedByUserId: {} };
  }

  const challenge = await getCurrentWeeklyChallenge();
  if (challenge.completedAt || session.date < challenge.weekStart) {
    return { completed: false, badgeUnlockedByUserId: {} };
  }

  const claimed = await prisma.weeklyChallenge.updateMany({
    where: { id: challenge.id, completedAt: null },
    data: { completedAt: wallClockNow(), completedBySessionId: sessionId },
  });
  if (claimed.count === 0) return { completed: false, badgeUnlockedByUserId: {} };

  const participants = await getWinningProposalParticipants(sessionId, session.decidedGameId);

  const badgeUnlockedByUserId: Record<string, boolean> = {};
  for (const participant of participants) {
    await awardXp(
      participant.id,
      "CHALLENGE_COMPLETE",
      challenge.id,
      XP_AMOUNTS.CHALLENGE_COMPLETE
    );
    badgeUnlockedByUserId[participant.id] = await checkChallengeBadges(participant.id);
  }

  return { completed: true, badgeUnlockedByUserId };
}
