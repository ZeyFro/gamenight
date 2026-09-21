import type { Session, SessionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAvailableAt } from "@/lib/availability";
import { sameUtcDate } from "@/lib/wallclock";
import { addDays, findBestSlot, type BestSlot, type HourSlot } from "@/lib/calendar-dates";
import { accessibleSessionWhere } from "@/lib/session-access";

/**
 * Données du calendrier collectif (PR 4/4, sous-PR 1). Grille horaire —
 * pour chaque (jour, heure) affiché, on demande à `isAvailableAt`
 * (`src/lib/availability.ts`, déjà utilisée par F5 pour le calcul
 * "jouable") si chaque user est dispo à CET instant précis. Choix
 * assumé : pas de logique de calcul de "plages" séparée pour le
 * calendrier — réutiliser `isAvailableAt` telle quelle par heure garantit
 * que le calendrier affiche exactement ce que F5 utiliserait pour
 * calculer une proposition à cette heure-là, sans jamais diverger (y
 * compris les cas limites déjà gérés — ou pas — par cette fonction,
 * ex. un créneau qui traverse minuit).
 *
 * Granularité horaire (pas à la minute) : suffisant pour "d'un coup
 * d'œil, qui est dispo quand" — le nombre d'appels (7 jours × 24h ×
 * N users pour une semaine) reste négligeable pour une biblio de groupe
 * d'amis (pas un souci de perf à cette échelle).
 */

export interface CalendarUser {
  id: string;
  discordName: string;
  discordAvatar: string | null;
  color: string;
}

export interface CalendarProposalSummary {
  gameName: string;
  voteCount: number;
}

export interface CalendarSession {
  id: string;
  date: Date;
  status: SessionStatus;
  votingDeadline: Date | null;
  createdById: string;
  decidedGameName: string | null;
  decidedGameCoverUrl: string | null;
  proposals: CalendarProposalSummary[];
  /** Voteurs de la proposition gagnante (`decidedGameId`) — mêmes "joueurs inscrits" que le "Qui vient" Discord (`src/lib/sessions.ts`). Vide tant qu'aucun jeu n'est décidé (VOTING). */
  players: CalendarUser[];
}

export interface CalendarDay {
  date: Date;
  hours: HourSlot[];
  sessions: CalendarSession[];
  /** Max de `availableUserIds.length` sur les heures du jour — résumé rapide pour la vue Mois. */
  maxAvailableCount: number;
}

export interface CalendarData {
  users: CalendarUser[];
  days: CalendarDay[];
  /** `null` si personne n'est dispo une seule heure sur toute la plage affichée. */
  bestSlot: BestSlot | null;
}

const HOURS_OF_DAY = Array.from({ length: 24 }, (_, h) => h);

function toCalendarSession(
  session: Session & {
    proposals: { gameId: string; votes: { user: CalendarUser }[]; game: { name: string } }[];
    decidedGame: { name: string; coverUrl: string | null } | null;
  }
): CalendarSession {
  const winningProposal = session.decidedGameId
    ? session.proposals.find((p) => p.gameId === session.decidedGameId)
    : undefined;

  return {
    id: session.id,
    date: session.date,
    status: session.status,
    votingDeadline: session.votingDeadline,
    createdById: session.createdById,
    decidedGameName: session.decidedGame?.name ?? null,
    decidedGameCoverUrl: session.decidedGame?.coverUrl ?? null,
    proposals: session.proposals.map((p) => ({
      gameName: p.game.name,
      voteCount: p.votes.length,
    })),
    players: winningProposal?.votes.map((v) => v.user) ?? [],
  };
}

/**
 * `end` exclusif (borne haute de la plage affichée, en jours). Récupère
 * tout le nécessaire en un minimum de requêtes (biblio de groupe d'amis,
 * pas la peine de paginer) : tous les users + leur dispo hebdo, les
 * exceptions et sessions dans la plage seulement.
 */
export async function getCalendarData(
  rangeStart: Date,
  rangeEndExclusive: Date,
  /** Confidentialité des soirées — soirées affichées sur le calendrier
   * (cards avec jeu/votants) restreintes à celles visibles par ce viewer
   * (créateur ou invité actif, voir src/lib/session-access.ts). La grille
   * de disponibilité elle-même (heures/users dispos) n'est PAS concernée
   * (aucune donnée de soirée, juste des créneaux personnels), mais ce
   * paramètre reste obligatoire pour qu'aucun appelant n'oublie de le
   * fournir. */
  viewerId: string,
  /** Filtre "potes affichés" (panneau collectif) — `undefined` = tout le monde. */
  visibleUserIds?: string[]
): Promise<CalendarData> {
  const [allUsers, weeklySlots, overrides, sessions] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, discordName: true, discordAvatar: true, color: true },
      orderBy: { discordName: "asc" },
    }),
    prisma.weeklyAvailability.findMany(),
    prisma.availabilityOverride.findMany({
      where: { date: { gte: rangeStart, lt: rangeEndExclusive } },
    }),
    prisma.session.findMany({
      where: { date: { gte: rangeStart, lt: rangeEndExclusive }, ...accessibleSessionWhere(viewerId) },
      include: {
        proposals: {
          select: {
            gameId: true,
            votes: {
              select: {
                user: { select: { id: true, discordName: true, discordAvatar: true, color: true } },
              },
            },
            game: { select: { name: true } },
          },
        },
        decidedGame: { select: { name: true, coverUrl: true } },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const visibleSet = visibleUserIds ? new Set(visibleUserIds) : null;
  const users = visibleSet ? allUsers.filter((u) => visibleSet.has(u.id)) : allUsers;

  const weeklyByUser = new Map<string, typeof weeklySlots>();
  for (const slot of weeklySlots) {
    const list = weeklyByUser.get(slot.userId) ?? [];
    list.push(slot);
    weeklyByUser.set(slot.userId, list);
  }

  const overridesByUser = new Map<string, typeof overrides>();
  for (const override of overrides) {
    const list = overridesByUser.get(override.userId) ?? [];
    list.push(override);
    overridesByUser.set(override.userId, list);
  }

  const sessionsByDay = new Map<string, CalendarSession[]>();
  for (const session of sessions) {
    const key = session.date.toISOString().slice(0, 10);
    const list = sessionsByDay.get(key) ?? [];
    list.push(toCalendarSession(session));
    sessionsByDay.set(key, list);
  }

  const days: CalendarDay[] = [];

  for (
    let dayDate = new Date(rangeStart);
    dayDate < rangeEndExclusive;
    dayDate = addDays(dayDate, 1)
  ) {
    const dayKey = dayDate.toISOString().slice(0, 10);
    const hours: HourSlot[] = [];
    let maxAvailableCount = 0;

    for (const hour of HOURS_OF_DAY) {
      const instant = new Date(dayDate);
      instant.setUTCHours(hour, 0, 0, 0);

      const availableUserIds = users
        .filter((user) => {
          const userOverride = overridesByUser
            .get(user.id)
            ?.find((o) => sameUtcDate(o.date, dayDate));
          return isAvailableAt(instant, weeklyByUser.get(user.id) ?? [], userOverride);
        })
        .map((user) => user.id);

      hours.push({ hour, availableUserIds });
      maxAvailableCount = Math.max(maxAvailableCount, availableUserIds.length);
    }

    days.push({
      date: new Date(dayDate),
      hours,
      sessions: sessionsByDay.get(dayKey) ?? [],
      maxAvailableCount,
    });
  }

  return {
    users,
    days,
    bestSlot: findBestSlot(days),
  };
}
