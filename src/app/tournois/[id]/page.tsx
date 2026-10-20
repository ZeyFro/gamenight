import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { communityIdFilter, getIsolationScope } from "@/lib/community-isolation";
import { totalRoundsFor, tournamentBracketSize } from "@/lib/tournaments";
import { getTournamentAnnounceStatus } from "@/lib/tournament-announce";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Stagger, StaggerItem } from "@/components/motion";
import { TournamentBracket } from "@/components/tournaments/TournamentBracket";
import { CancelTournamentDialog } from "@/components/tournois/CancelTournamentDialog";
import { DeleteTournamentDialog } from "@/components/tournois/DeleteTournamentDialog";
import {
  registerForTournamentAction,
  unregisterFromTournamentAction,
  launchTournamentAction,
  resyncTournamentThreadMembersAction,
} from "../actions";
import { pageMetadata } from "@/lib/page-title";
import { isTournamentScoresEnabled } from "@/lib/tournament-scores";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { isTournamentPredictionsEnabled } from "@/lib/tournament-prediction-rules";
import { TournamentPredictions } from "@/components/tournaments/TournamentPredictions";
import { findActiveMembership } from "@/lib/community-access";
import { statsCommunityIdForSession } from "@/lib/community-stats";

export const metadata = pageMetadata("Tournoi");

const TOURNAMENT_ERROR_MESSAGES: Record<string, string> = {
  prediction: "Pronostic refusé : la cible est fermée, déjà choisie ou inaccessible. Actualise la page.",
  rate_limited: RATE_LIMIT_MESSAGE,
  scores: "Scores refusés : renseigne les deux scores, entre 0 et 999, avec le score le plus élevé pour le gagnant.",
};

const ANNOUNCE_STATUS_LABELS: Record<"pending" | "sent" | "failed", { text: string; tone: "accent" | "warning" | "neutral" }> = {
  pending: { text: "⏳ En attente d'envoi", tone: "neutral" },
  sent: { text: "✓ Annonce envoyée", tone: "accent" },
  failed: { text: "⚠️ Échec d'envoi", tone: "warning" },
};

const THREAD_STATUS_LABELS: Record<"pending" | "sent" | "failed", { text: string; tone: "accent" | "warning" | "neutral" }> = {
  pending: { text: "⏳ Fil en attente de création", tone: "neutral" },
  sent: { text: "✓ Fil créé", tone: "accent" },
  failed: { text: "⚠️ Échec de création du fil", tone: "warning" },
};

/**
 * Sprint 5 (FEATURE 1, Tournois Bracket) — page détail : inscriptions
 * (`REGISTRATION`), bracket + résolution des matchs (`IN_PROGRESS`),
 * résultat final (`DONE`).
 */
export default async function TournoiDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const { error } = await searchParams;
  const errorMessage = error ? (TOURNAMENT_ERROR_MESSAGES[error] ?? null) : null;

  // Multi-communautés (PR4) : un tournoi d'une autre communauté est
  // indistinct d'un tournoi inexistant (aucun filtre si l'isolation est éteinte).
  const tournament = await prisma.tournament.findFirst({
    where: { id, ...communityIdFilter(await getIsolationScope(user.id)) },
    include: {
      game: { select: { name: true, coverUrl: true } },
      createdBy: { select: { discordName: true } },
      champion: { select: { discordName: true, discordAvatar: true } },
      championTeam: { select: { name: true } },
      participants: {
        include: { user: { select: { id: true, discordName: true, discordAvatar: true } } },
        orderBy: { seed: "asc" },
      },
      matches: {
        include: {
          player1: { select: { id: true, discordName: true, discordAvatar: true } },
          player2: { select: { id: true, discordName: true, discordAvatar: true } },
          team1: {
            include: {
              members: {
                include: {
                  participant: { include: { user: { select: { id: true, discordName: true } } } },
                },
              },
            },
          },
          team2: {
            include: {
              members: {
                include: {
                  participant: { include: { user: { select: { id: true, discordName: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!tournament) notFound();

  const predictionsEnabled = tournament.format === "INDIVIDUAL" && isTournamentPredictionsEnabled() && !!(await findActiveMembership(user.id, await statsCommunityIdForSession(tournament.communityId)));
  const scopedDb = predictionsEnabled ? await getScopedPrisma(user.id) : null;
  const predictions = scopedDb ? await scopedDb.tournamentPrediction.findMany({ where: { tournamentId: id, voterId: user.id } }) : [];

  const isCreator = tournament.createdById === user.id;
  const isRegistered = tournament.participants.some((p) => p.userId === user.id);
  const totalRounds = totalRoundsFor(tournamentBracketSize(tournament.maxPlayers, tournament.format));
  const bracketMatches = tournament.format === "TEAMS"
    ? tournament.matches.map((match) => ({
        ...match,
        player1: match.team1 ? {
          id: match.team1.id,
          discordName: `${match.team1.name} · ${match.team1.members.map((m) => m.participant.user.discordName).join(" + ")}`,
          discordAvatar: null,
          memberIds: match.team1.members.map((m) => m.participant.user.id),
        } : null,
        player2: match.team2 ? {
          id: match.team2.id,
          discordName: `${match.team2.name} · ${match.team2.members.map((m) => m.participant.user.discordName).join(" + ")}`,
          discordAvatar: null,
          memberIds: match.team2.members.map((m) => m.participant.user.id),
        } : null,
        winnerId: match.winnerTeamId,
      }))
    : tournament.matches;

  // V2 (délai/état d'envoi) — statut RÉEL de l'annonce/du fil, jamais
  // présenté comme instantané (voir `getTournamentAnnounceStatus`,
  // tournament-announce.ts) : réservé au créateur, et seulement pour un
  // tournoi resté sur le chemin bot (rien à afficher pour le webhook, qui
  // ne trace aucun état de livraison).
  const announceStatus =
    isCreator && tournament.announceViaBot ? await getTournamentAnnounceStatus(tournament.id) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🏆 {tournament.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {tournament.game.name} · Créé par {tournament.createdBy.discordName}
        </p>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</p>
      )}

      {predictionsEnabled && <TournamentPredictions tournament={tournament} predictions={predictions} />}
      {tournament.format === "TEAMS" && isTournamentPredictionsEnabled() && (
        <p className="text-xs text-muted">Les pronostics individuels ne sont pas proposés pour les tournois en équipes.</p>
      )}

      {announceStatus && (
        <Card className="flex flex-col gap-2 text-sm">
          <p className="font-medium text-foreground">Annonce Discord</p>
          <p className={announceStatus.announce === "failed" ? "text-warning" : announceStatus.announce === "sent" ? "text-accent" : "text-muted"}>
            {ANNOUNCE_STATUS_LABELS[announceStatus.announce].text}
          </p>
          <p className={announceStatus.thread === "failed" ? "text-warning" : announceStatus.thread === "sent" ? "text-accent" : "text-muted"}>
            {THREAD_STATUS_LABELS[announceStatus.thread].text}
          </p>
          {announceStatus.thread === "sent" && (
            <form action={resyncTournamentThreadMembersAction} className="mt-1">
              <input type="hidden" name="tournamentId" value={tournament.id} />
              <Button type="submit" variant="secondary" size="sm">
                Resynchroniser le fil
              </Button>
              <p className="mt-1 text-xs text-muted">
                Réajoute le créateur, les destinataires sélectionnés et les inscrits au fil —
                sans renvoyer d&apos;annonce ni reping personne.
              </p>
            </form>
          )}
        </Card>
      )}

      {tournament.status === "CANCELLED" && (
        <Card className="flex flex-col gap-1 border-destructive/30 bg-destructive/10">
          <p className="font-medium text-destructive">❌ Tournoi annulé</p>
          {tournament.cancelledAt && (
            <p className="text-sm text-muted">Annulé le {formatDateTimeFr(tournament.cancelledAt)}.</p>
          )}
          <p className="text-sm text-muted">
            Les matchs et résultats déjà enregistrés restent visibles ci-dessous.
          </p>
        </Card>
      )}

      {isCreator && (tournament.status === "REGISTRATION" || tournament.status === "IN_PROGRESS") && (
        <div className="flex justify-end">
          {tournament.status === "REGISTRATION" ? (
            <DeleteTournamentDialog tournamentId={tournament.id} />
          ) : (
            <CancelTournamentDialog tournamentId={tournament.id} />
          )}
        </div>
      )}

      {tournament.status === "DONE" && (tournament.champion || tournament.championTeam) && (
        <Card className="card-glow flex flex-col items-center gap-3 text-center">
          <span className="text-4xl" aria-hidden>
            🏆
          </span>
          {tournament.champion && <Avatar src={tournament.champion.discordAvatar} alt={tournament.champion.discordName} size={56} />}
          <p className="text-lg font-semibold text-foreground">
            {tournament.championTeam?.name ?? tournament.champion?.discordName} remporte le tournoi !
          </p>
        </Card>
      )}

      {tournament.status === "REGISTRATION" && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Inscriptions</p>
            <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              {tournament.participants.length}/{tournament.maxPlayers}
            </span>
          </div>

          <Stagger className="flex flex-col gap-2">
            {tournament.participants.map((p) => (
              <StaggerItem key={p.id}>
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2">
                  <Avatar src={p.user.discordAvatar} alt={p.user.discordName} size={28} />
                  <span className="truncate text-sm text-foreground">{p.user.discordName}</span>
                </div>
              </StaggerItem>
            ))}
            {tournament.participants.length === 0 && (
              <p className="text-sm text-muted">Personne inscrit pour l&apos;instant.</p>
            )}
          </Stagger>

          <div className="flex flex-col gap-2 sm:flex-row">
            {isRegistered ? (
              <form action={unregisterFromTournamentAction} className="flex-1">
                <input type="hidden" name="tournamentId" value={tournament.id} />
                <Button type="submit" variant="secondary" fullWidthOnMobile>
                  Se désinscrire
                </Button>
              </form>
            ) : (
              tournament.participants.length < tournament.maxPlayers && (
                <form action={registerForTournamentAction} className="flex-1">
                  <input type="hidden" name="tournamentId" value={tournament.id} />
                  <Button type="submit" variant="primary" fullWidthOnMobile>
                    S&apos;inscrire
                  </Button>
                </form>
              )
            )}

            {isCreator && tournament.participants.length >= (tournament.format === "TEAMS" ? 4 : 2) &&
              (tournament.format !== "TEAMS" || tournament.participants.length % 2 === 0) && (
              <form action={launchTournamentAction} className="flex-1">
                <input type="hidden" name="tournamentId" value={tournament.id} />
                <Button type="submit" variant="secondary" fullWidthOnMobile>
                  Lancer le tournoi 🚀
                </Button>
              </form>
            )}
          </div>
        </Card>
      )}

      {(tournament.status === "IN_PROGRESS" ||
        tournament.status === "DONE" ||
        tournament.status === "CANCELLED") && (
        <TournamentBracket
          matches={bracketMatches}
          totalRounds={totalRounds}
          currentUserId={user.id}
          isCreator={isCreator}
          interactive={tournament.status === "IN_PROGRESS"}
          showScores={isTournamentScoresEnabled()}
        />
      )}
    </div>
  );
}
