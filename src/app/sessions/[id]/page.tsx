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
import {
  finalizeSuperlativeVotingIfDue,
  getWinningProposalParticipants,
} from "@/lib/superlative-voting";
import { getPronosticEligibleUsers } from "@/lib/pronostics";
import { getChatMessages } from "@/lib/chat";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, toDateInputValue, toTimeInputValue } from "@/lib/wallclock";
import { SESSION_SCHEDULE_ERROR_MESSAGES } from "@/lib/session-schedule";
import { getCurrentWeeklyChallenge } from "@/lib/weekly-challenges";
import { VotingCountdown } from "@/components/VotingCountdown";
import { VoteButton } from "@/components/VoteButton";
import { VoterAvatars } from "@/components/VoterAvatars";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { DeleteSessionDialog } from "@/components/DeleteSessionDialog";
import { EditSessionDialog } from "@/components/EditSessionDialog";
import { WithdrawProposalDialog } from "@/components/WithdrawProposalDialog";
import { ProposeGameForm } from "@/components/ProposeGameForm";
import { PronosticForm } from "@/components/PronosticForm";
import { XpBetForm } from "@/components/XpBetForm";
import { ChatMessages } from "@/components/chat/ChatMessages";
import {
  cancelSessionAction,
  closeSessionAction,
  completeWeeklyChallengeAction,
  markSessionDoneAction,
  resendDiscordAction,
} from "../actions";

const DISCORD_MESSAGES: Record<string, { text: string; tone: "warning" | "accent" }> = {
  // Texte volontairement générique ("l'action") : ce même statut couvre la
  // création, la clôture, la modification et le renvoi manuel de session —
  // plusieurs contextes différents qui redirigent tous ici avec
  // `?discord=echec|envoye`.
  echec: {
    text: "L'action a bien été enregistrée, mais l'envoi Discord a échoué.",
    tone: "warning",
  },
  envoye: { text: "Message envoyé dans Discord.", tone: "accent" },
};

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ discord?: string; deadline?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const { discord, deadline, error } = await searchParams;
  const discordMessage = discord ? DISCORD_MESSAGES[discord] : null;
  const deadlineAdjusted = deadline === "ajustee";
  const errorMessage = error ? SESSION_SCHEDULE_ERROR_MESSAGES[error] : null;

  await closeSessionIfDue(id);
  await finalizeSuperlativeVotingIfDue(id);

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      decidedGame: true,
      proposals: {
        include: { game: true, votes: { include: { user: true } }, proposedBy: true },
        orderBy: { createdAt: "asc" },
      },
      results: { select: { id: true }, take: 1 },
    },
  });
  if (!session) notFound();

  // Badge "🏆 Vote les superlatifs !" — même définition de participant que
  // partout ailleurs dans le chantier (users ayant voté pour la
  // proposition gagnante).
  let needsSuperlativeVote = false;
  if (
    session.status === "DONE" &&
    session.decidedGameId &&
    !session.superlativeVotingClosed
  ) {
    const superlativeParticipants = await getWinningProposalParticipants(
      session.id,
      session.decidedGameId
    );
    if (superlativeParticipants.some((p) => p.id === user.id)) {
      const alreadyVoted = await prisma.superlativeVote.count({
        where: { sessionId: session.id, voterUserId: user.id },
      });
      needsSuperlativeVote = alreadyVoted === 0;
    }
  }

  // Sprint 4 — Pronostics + Paris d'XP, ouverts pendant que la soirée est
  // `SCHEDULED` (mêmes participants éligibles que le futur vote de
  // superlatifs) ; révélés une fois `DONE` ET les superlatifs clôturés
  // (`superlativeVotingClosed`), pour ne jamais montrer un résultat avant
  // que le "carry" de la soirée soit connu.
  let pronosticData: {
    participants: { id: string; discordName: string; discordAvatar: string | null }[];
    isParticipant: boolean;
    alreadySubmitted: boolean;
    submittedCount: number;
  } | null = null;
  let revealData: {
    pronostics: { voterName: string; predictedName: string; correct: boolean | null }[];
    bets: { voterName: string; targetName: string; amount: number; won: boolean | null }[];
  } | null = null;

  if (session.status === "SCHEDULED" && session.decidedGameId) {
    const participants = await getPronosticEligibleUsers(session.id, session.decidedGameId);
    const isParticipant = participants.some((p) => p.id === user.id);
    if (isParticipant) {
      const [ownPronostic, submittedCount] = await Promise.all([
        prisma.pronostic.findUnique({
          where: { sessionId_voterId: { sessionId: session.id, voterId: user.id } },
        }),
        prisma.pronostic.count({ where: { sessionId: session.id } }),
      ]);
      pronosticData = {
        participants: participants.map((p) => ({
          id: p.id,
          discordName: p.discordName,
          discordAvatar: p.discordAvatar,
        })),
        isParticipant,
        alreadySubmitted: ownPronostic !== null,
        submittedCount,
      };
    }
  }

  if (session.status === "DONE" && session.superlativeVotingClosed) {
    const [pronostics, bets] = await Promise.all([
      prisma.pronostic.findMany({
        where: { sessionId: session.id },
        include: { voter: true, predictedUser: true },
      }),
      prisma.xpBet.findMany({
        where: { sessionId: session.id },
        include: { voter: true, target: true },
      }),
    ]);
    if (pronostics.length > 0 || bets.length > 0) {
      revealData = {
        pronostics: pronostics.map((p) => ({
          voterName: p.voter.discordName,
          predictedName: p.predictedUser.discordName,
          correct: p.correct,
        })),
        bets: bets.map((b) => ({
          voterName: b.voter.discordName,
          targetName: b.target.discordName,
          amount: b.amount,
          won: b.won,
        })),
      };
    }
  }

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
  // Modifier/supprimer/clôturer manuellement/annuler sont réservés au
  // créateur — les autres membres du groupe proposent, votent, et
  // consultent la session normalement. La clôture automatique
  // (`closeSessionIfDue`, appelée juste au-dessus) reste ouverte à tous :
  // elle se déclenche à la lecture, sans bouton, donc sans notion de "qui
  // clique".
  const isCreator = session.createdById === user.id;
  // Modifier n'a de sens que pour une soirée pas encore figée — pas pour
  // une session DONE (déjà jouée) ou CANCELLED (rien à reprogrammer).
  const canEdit = session.status === "VOTING" || session.status === "SCHEDULED";

  // Défi hebdo (Sprint 3 suite) — bouton "Marquer comme complété" réservé
  // au créateur d'une soirée DONE, et seulement si le défi de LA SEMAINE
  // EN COURS n'est pas déjà complété (`completeWeeklyChallenge` refuse de
  // toute façon une vieille soirée hors de cette semaine, cf. son
  // commentaire — la requête n'est faite que si elle peut servir).
  const weeklyChallenge =
    session.status === "DONE" && isCreator ? await getCurrentWeeklyChallenge() : null;
  const canCompleteWeeklyChallenge =
    weeklyChallenge !== null &&
    !weeklyChallenge.completedAt &&
    session.date >= weeklyChallenge.weekStart;

  // Sprint 5 (Chat in-app) — canal dédié à cette soirée.
  const chatMessages = await getChatMessages(session.id);

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

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      {deadlineAdjusted && (
        <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
          L&apos;heure limite de vote que tu avais choisie était déjà
          passée (ou trop proche de l&apos;heure de la session) — elle a
          été automatiquement décalée à{" "}
          <strong>{formatDateTimeFr(votingClosesAt(session))}</strong> pour
          laisser un minimum de temps pour voter.
        </p>
      )}

      {discordMessage && (
        <p
          className={`rounded-lg p-3 text-sm ${
            discordMessage.tone === "warning"
              ? "bg-warning/10 text-warning"
              : "bg-accent/10 text-accent"
          }`}
        >
          {discordMessage.text}
        </p>
      )}

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

      {pronosticData && (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="font-semibold text-foreground">🔮 Qui va carry ?</h2>
            <p className="text-xs text-muted">
              {pronosticData.submittedCount}/{pronosticData.participants.length} ont
              pronostiqué. Résultat révélé après la soirée.
            </p>
          </div>
          {pronosticData.alreadySubmitted ? (
            <p className="text-sm text-accent">
              Pronostic enregistré — réponse au tirage des récompenses.
            </p>
          ) : (
            <PronosticForm
              sessionId={session.id}
              voterId={user.id}
              participants={pronosticData.participants}
            />
          )}

          <div className="border-t border-border pt-4">
            <h2 className="font-semibold text-foreground">🎲 Paris</h2>
            <p className="mb-3 text-xs text-muted">
              Mise de l&apos;XP sur qui va carry — double ou rien.
            </p>
            <XpBetForm
              sessionId={session.id}
              voterId={user.id}
              xpTotal={user.xpTotal}
              targets={pronosticData.participants}
            />
          </div>
        </Card>
      )}

      {revealData && (revealData.pronostics.length > 0 || revealData.bets.length > 0) && (
        <Card className="flex flex-col gap-4">
          {revealData.pronostics.length > 0 && (
            <div>
              <h2 className="font-semibold text-foreground">🔮 Résultats des pronostics</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {revealData.pronostics.map((p, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span>{p.correct ? "✅" : "❌"}</span>
                    <span className="text-muted">
                      {p.voterName} avait prédit {p.predictedName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {revealData.bets.length > 0 && (
            <div className="border-t border-border pt-4">
              <h2 className="font-semibold text-foreground">🎲 Résultats des paris</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {revealData.bets.map((b, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span>{b.won ? "✅" : "❌"}</span>
                    <span className="text-muted">
                      {b.voterName} a parié {b.amount} XP sur {b.targetName}
                      {b.won ? ` — +${b.amount * 2} XP` : " — perdu"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {session.status === "CANCELLED" && (
        <Card>
          <p className="text-sm text-muted">Cette soirée a été annulée.</p>
        </Card>
      )}

      {(session.status === "SCHEDULED" ||
        session.status === "DONE" ||
        session.status === "CANCELLED") && (
        <form action={resendDiscordAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <Button type="submit" variant="secondary" size="sm">
            Renvoyer dans Discord
          </Button>
        </form>
      )}

      {session.status === "VOTING" && isCreator && (
        <div className="flex flex-wrap gap-3">
          {canEdit && (
            <EditSessionDialog
              sessionId={session.id}
              dateValue={toDateInputValue(session.date)}
              timeValue={toTimeInputValue(session.date)}
              deadlineDateValue={toDateInputValue(votingClosesAt(session))}
              deadlineTimeValue={toTimeInputValue(votingClosesAt(session))}
            />
          )}
          <form action={closeSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <Button type="submit" size="sm">
              Clôturer le vote maintenant
            </Button>
          </form>
          {/* FIX Sprint 3 (roulette async) — alternative au vote classique : au
              lieu de proposer/voter à la main, le créateur peut basculer sur
              une roulette pré-remplie avec la date déjà choisie ici. */}
          <ButtonLink
            href={`/roulette?tab=creer&date=${toDateInputValue(session.date)}&time=${toTimeInputValue(session.date)}`}
            variant="secondary"
            size="sm"
          >
            🎰 Roulette
          </ButtonLink>
          <form action={cancelSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <Button type="submit" variant="destructive" size="sm">
              Annuler la soirée
            </Button>
          </form>
        </div>
      )}

      {session.status === "SCHEDULED" && isCreator && (
        <div className="flex flex-wrap gap-3">
          {canEdit && (
            <EditSessionDialog
              sessionId={session.id}
              dateValue={toDateInputValue(session.date)}
              timeValue={toTimeInputValue(session.date)}
              deadlineDateValue={toDateInputValue(votingClosesAt(session))}
              deadlineTimeValue={toTimeInputValue(votingClosesAt(session))}
            />
          )}
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

      {session.status === "DONE" && isCreator && (
        <div className="flex flex-wrap gap-3">
          <ButtonLink
            href={`/sessions/${session.id}/resultats`}
            variant="primary"
            size="sm"
          >
            {session.results.length > 0
              ? "Voir les résultats"
              : "🏆 Saisir les résultats"}
          </ButtonLink>
          {canCompleteWeeklyChallenge && (
            <form action={completeWeeklyChallengeAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <Button type="submit" variant="secondary" size="sm">
                🎯 Marquer le défi comme complété
              </Button>
            </form>
          )}
        </div>
      )}

      {session.status === "DONE" && session.decidedGame && (
        <div className="flex flex-wrap gap-3">
          <ButtonLink
            href={`/sessions/${session.id}/vote-superlatifs`}
            variant={needsSuperlativeVote ? "primary" : "secondary"}
            size="sm"
          >
            {needsSuperlativeVote
              ? "🏆 Vote les récompenses !"
              : "🏆 Récompenses"}
          </ButtonLink>
        </div>
      )}

      {isCreator && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <span className="text-xs text-muted">
            Tu as créé cette soirée —
          </span>
          <DeleteSessionDialog sessionId={session.id} />
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
                    <Link
                      href={`/jeux/${proposal.gameId}`}
                      className="flex min-w-0 flex-1 items-start gap-3"
                    >
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
                        <p className="font-medium text-foreground hover:underline">
                          {proposal.game.name}
                        </p>
                        <p className="text-xs text-muted">
                          Proposé par {proposal.proposedBy.discordName} ·{" "}
                          {proposal.game.minPlayers ?? "?"}–
                          {proposal.game.maxPlayers ?? "?"} joueurs
                        </p>
                      </div>
                    </Link>
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

                  <div className="flex items-center justify-between gap-3">
                    <VoteButton
                      proposalId={proposal.id}
                      sessionId={session.id}
                      initialVoted={voted}
                      initialCount={proposal.votes.length}
                      disabled={!votingOpen}
                    />
                    {votingOpen && proposal.proposedById === user.id && (
                      <WithdrawProposalDialog
                        sessionId={session.id}
                        proposalId={proposal.id}
                        gameName={proposal.game.name}
                      />
                    )}
                  </div>

                  <VoterAvatars
                    voters={proposal.votes.map((v) => ({
                      id: v.user.id,
                      discordName: v.user.discordName,
                      discordAvatar: v.user.discordAvatar,
                      color: v.user.color,
                    }))}
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
              <ProposeGameForm
                sessionId={session.id}
                games={availableGames.map((g) => ({ id: g.id, name: g.name }))}
              />
            </Card>
          )}
        </section>
      )}

      <section className="flex min-h-0 flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">💬 Chat</h2>
        <Card className="flex h-[28rem] flex-col p-0">
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <ChatMessages sessionId={session.id} currentUserId={user.id} initialMessages={chatMessages} />
          </div>
        </Card>
      </section>
    </div>
  );
}
