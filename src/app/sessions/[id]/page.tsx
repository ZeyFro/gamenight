import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  closeSessionIfDue,
  getProposalAvailability,
  isVotingOpen,
  votingClosesAt,
} from "@/lib/sessions";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr } from "@/lib/wallclock";
import { VotingCountdown } from "@/components/VotingCountdown";
import { VoteButton } from "@/components/VoteButton";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ActionForm } from "@/components/ActionForm";
import { Stagger, StaggerItem } from "@/components/motion";
import {
  cancelSessionAction,
  closeSessionAction,
  markSessionDoneAction,
  proposeGame,
} from "../actions";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  await closeSessionIfDue(id);

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      decidedGame: true,
      proposals: {
        include: { game: true, votes: true, proposedBy: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!session) notFound();

  const availability = await getProposalAvailability(
    session.date,
    session.proposals.map((p) => p.game)
  );

  const votingOpen = isVotingOpen(session);

  const proposedGameIds = session.proposals.map((p) => p.gameId);
  const availableGames = votingOpen
    ? await prisma.game.findMany({
        where: {
          userGames: { some: { owned: true } },
          id: { notIn: proposedGameIds },
        },
        orderBy: { name: "asc" },
      })
    : [];

  const status = SESSION_STATUS_LABELS[session.status];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link href="/sessions" className="text-sm text-muted hover:text-foreground hover:underline">
          ← Soirées
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground capitalize sm:text-2xl">
            {formatDateTimeFr(session.date)}
          </h1>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
          >
            {status.label}
          </span>
        </div>
        {session.status === "VOTING" && (
          <VotingCountdown deadline={votingClosesAt(session).toISOString()} />
        )}
      </div>

      {(session.status === "SCHEDULED" || session.status === "DONE") &&
        session.decidedGame && (
          <Card
            className={`flex items-center gap-4 ${
              session.status === "SCHEDULED" ? "border-accent/40 bg-accent/10" : ""
            }`}
          >
            {session.decidedGame.coverUrl && (
              <Image
                src={session.decidedGame.coverUrl}
                alt={session.decidedGame.name}
                width={56}
                height={75}
                className="rounded object-cover"
              />
            )}
            <div>
              <p
                className={
                  session.status === "SCHEDULED"
                    ? "text-sm text-accent"
                    : "text-sm text-muted"
                }
              >
                {session.status === "SCHEDULED" ? "Jeu retenu" : "Jeu joué"}
              </p>
              <p className="font-semibold text-foreground">
                {session.decidedGame.name}
              </p>
            </div>
          </Card>
        )}

      {session.status === "CANCELLED" && (
        <Card>
          <p className="text-sm text-muted">Cette soirée a été annulée.</p>
        </Card>
      )}

      {session.status === "VOTING" && (
        <div className="flex flex-wrap gap-3">
          <form action={closeSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <Button type="submit" size="sm">
              Clôturer le vote maintenant
            </Button>
          </form>
          <form action={cancelSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <Button type="submit" variant="destructive" size="sm">
              Annuler la soirée
            </Button>
          </form>
        </div>
      )}

      {session.status === "SCHEDULED" && (
        <div className="flex flex-wrap gap-3">
          <form action={markSessionDoneAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <Button type="submit" size="sm">
              Marquer comme terminée
            </Button>
          </form>
          <form action={cancelSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <Button type="submit" variant="destructive" size="sm">
              Annuler
            </Button>
          </form>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Propositions
          {session.proposals.length > 0 && ` (${session.proposals.length})`}
        </h2>

        {session.proposals.length === 0 && (
          <Card>
            <p className="text-sm text-muted">
              Aucun jeu proposé pour l&apos;instant.
            </p>
          </Card>
        )}

        <Stagger className="flex flex-col gap-3">
          {session.proposals.map((proposal) => {
            const stats = availability.get(proposal.gameId);
            const availableCount = stats?.availableOwners.length ?? 0;
            const voted = proposal.votes.some((v) => v.userId === user.id);

            return (
              <StaggerItem key={proposal.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    {proposal.game.coverUrl && (
                      <Image
                        src={proposal.game.coverUrl}
                        alt={proposal.game.name}
                        width={48}
                        height={64}
                        className="shrink-0 rounded object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {proposal.game.name}
                      </p>
                      <p className="text-xs text-muted">
                        Proposé par {proposal.proposedBy.discordName} ·{" "}
                        {proposal.game.minPlayers ?? "?"}–
                        {proposal.game.maxPlayers ?? "?"} joueurs
                      </p>
                    </div>
                    <Badge
                      tone={stats?.jouable ? "accent" : "neutral"}
                      glow={stats?.jouable}
                      animate
                    >
                      {stats?.jouable ? "JOUABLE" : "PAS ASSEZ DE JOUEURS"}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted">
                    {availableCount} dispo{availableCount > 1 ? "s" : ""} et
                    possède le jeu
                    {availableCount > 0 && (
                      <>
                        {" : "}
                        {stats!.availableOwners
                          .map((o) => o.discordName)
                          .join(", ")}
                      </>
                    )}
                  </p>

                  <VoteButton
                    proposalId={proposal.id}
                    sessionId={session.id}
                    initialVoted={voted}
                    initialCount={proposal.votes.length}
                    disabled={!votingOpen}
                  />
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      </section>

      {votingOpen && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            Proposer un jeu
          </h2>
          {availableGames.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">
                Tous les jeux de la biblio commune sont déjà proposés, ou
                personne n&apos;en possède encore.{" "}
                <Link
                  href="/bibliotheque/ajouter"
                  className="text-accent underline underline-offset-2"
                >
                  Ajouter un jeu
                </Link>
              </p>
            </Card>
          ) : (
            <Card>
              <ActionForm
                action={proposeGame}
                successMessage="Jeu proposé"
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <input type="hidden" name="sessionId" value={session.id} />
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-xs text-muted" htmlFor="gameId">
                    Jeu
                  </label>
                  <select
                    id="gameId"
                    name="gameId"
                    required
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                  >
                    {availableGames.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" variant="primary" fullWidthOnMobile>
                  Proposer
                </Button>
              </ActionForm>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
