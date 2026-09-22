import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { totalRoundsFor, bracketSizeFor } from "@/lib/tournaments";
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
} from "../actions";

const TOURNAMENT_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: RATE_LIMIT_MESSAGE,
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

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    include: {
      game: { select: { name: true, coverUrl: true } },
      createdBy: { select: { discordName: true } },
      champion: { select: { discordName: true, discordAvatar: true } },
      participants: {
        include: { user: { select: { id: true, discordName: true, discordAvatar: true } } },
        orderBy: { seed: "asc" },
      },
      matches: {
        include: {
          player1: { select: { id: true, discordName: true, discordAvatar: true } },
          player2: { select: { id: true, discordName: true, discordAvatar: true } },
        },
      },
    },
  });
  if (!tournament) notFound();

  const isCreator = tournament.createdById === user.id;
  const isRegistered = tournament.participants.some((p) => p.userId === user.id);
  const totalRounds = totalRoundsFor(bracketSizeFor(tournament.maxPlayers));

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

      {announceStatus && (
        <Card className="flex flex-col gap-2 text-sm">
          <p className="font-medium text-foreground">Annonce Discord</p>
          <p className={announceStatus.announce === "failed" ? "text-warning" : announceStatus.announce === "sent" ? "text-accent" : "text-muted"}>
            {ANNOUNCE_STATUS_LABELS[announceStatus.announce].text}
          </p>
          <p className={announceStatus.thread === "failed" ? "text-warning" : announceStatus.thread === "sent" ? "text-accent" : "text-muted"}>
            {THREAD_STATUS_LABELS[announceStatus.thread].text}
          </p>
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

      {tournament.status === "DONE" && tournament.champion && (
        <Card className="card-glow flex flex-col items-center gap-3 text-center">
          <span className="text-4xl" aria-hidden>
            🏆
          </span>
          <Avatar
            src={tournament.champion.discordAvatar}
            alt={tournament.champion.discordName}
            size={56}
          />
          <p className="text-lg font-semibold text-foreground">
            {tournament.champion.discordName} remporte le tournoi !
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

            {isCreator && tournament.participants.length >= 2 && (
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
          matches={tournament.matches}
          totalRounds={totalRounds}
          currentUserId={user.id}
          isCreator={isCreator}
          interactive={tournament.status === "IN_PROGRESS"}
        />
      )}
    </div>
  );
}
