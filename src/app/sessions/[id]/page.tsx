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
import {
  cancelSessionAction,
  closeSessionAction,
  markSessionDoneAction,
  proposeGame,
  toggleVote,
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
        <Link href="/sessions" className="text-sm text-zinc-500 hover:underline">
          ← Soirées
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-950 capitalize sm:text-2xl dark:text-zinc-50">
            {formatDateTimeFr(session.date)}
          </h1>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
          >
            {status.label}
          </span>
        </div>
        {session.status === "VOTING" && (
          <VotingCountdown
            deadline={votingClosesAt(session).toISOString()}
          />
        )}
      </div>

      {(session.status === "SCHEDULED" || session.status === "DONE") &&
        session.decidedGame && (
          <div
            className={`flex items-center gap-4 rounded-2xl p-4 ${
              session.status === "SCHEDULED"
                ? "bg-emerald-50 dark:bg-emerald-950/30"
                : "bg-white shadow-sm dark:bg-zinc-950"
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
                    ? "text-sm text-emerald-700 dark:text-emerald-400"
                    : "text-sm text-zinc-500"
                }
              >
                {session.status === "SCHEDULED" ? "Jeu retenu" : "Jeu joué"}
              </p>
              <p className="font-semibold text-zinc-950 dark:text-zinc-50">
                {session.decidedGame.name}
              </p>
            </div>
          </div>
        )}

      {session.status === "CANCELLED" && (
        <p className="rounded-2xl bg-zinc-100 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Cette soirée a été annulée.
        </p>
      )}

      {session.status === "VOTING" && (
        <div className="flex flex-wrap gap-3">
          <form action={closeSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="rounded-full border border-zinc-300 px-4 py-3 text-base font-medium hover:bg-zinc-100 sm:py-2 sm:text-sm dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Clôturer le vote maintenant
            </button>
          </form>
          <form action={cancelSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="rounded-full border border-red-300 px-4 py-3 text-base font-medium text-red-700 hover:bg-red-50 sm:py-2 sm:text-sm dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              Annuler la soirée
            </button>
          </form>
        </div>
      )}

      {session.status === "SCHEDULED" && (
        <div className="flex flex-wrap gap-3">
          <form action={markSessionDoneAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="rounded-full border border-zinc-300 px-4 py-3 text-base font-medium hover:bg-zinc-100 sm:py-2 sm:text-sm dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Marquer comme terminée
            </button>
          </form>
          <form action={cancelSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="rounded-full border border-red-300 px-4 py-3 text-base font-medium text-red-700 hover:bg-red-50 sm:py-2 sm:text-sm dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              Annuler
            </button>
          </form>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          Propositions
          {session.proposals.length > 0 && ` (${session.proposals.length})`}
        </h2>

        {session.proposals.length === 0 && (
          <p className="rounded-2xl bg-white p-4 text-sm text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-400">
            Aucun jeu proposé pour l&apos;instant.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {session.proposals.map((proposal) => {
            const stats = availability.get(proposal.gameId);
            const availableCount = stats?.availableOwners.length ?? 0;
            const voted = proposal.votes.some((v) => v.userId === user.id);

            return (
              <div
                key={proposal.id}
                className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-950"
              >
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
                    <p className="font-medium text-zinc-950 dark:text-zinc-50">
                      {proposal.game.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Proposé par {proposal.proposedBy.discordName} ·{" "}
                      {proposal.game.minPlayers ?? "?"}–
                      {proposal.game.maxPlayers ?? "?"} joueurs
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      stats?.jouable
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {stats?.jouable ? "JOUABLE" : "PAS ASSEZ DE JOUEURS"}
                  </span>
                </div>

                <p className="text-sm text-zinc-600 dark:text-zinc-400">
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

                <div className="flex items-center justify-between">
                  <form action={toggleVote}>
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <input type="hidden" name="sessionId" value={session.id} />
                    <button
                      type="submit"
                      disabled={!votingOpen}
                      className={`rounded-full px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                        voted
                          ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                          : "border border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {voted ? "✓ Voté" : "Voter"}
                    </button>
                  </form>
                  <p className="text-sm text-zinc-500">
                    {proposal.votes.length} vote
                    {proposal.votes.length > 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {votingOpen && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Proposer un jeu
          </h2>
          {availableGames.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-400">
              Tous les jeux de la biblio commune sont déjà proposés, ou
              personne n&apos;en possède encore.{" "}
              <Link
                href="/bibliotheque/ajouter"
                className="underline underline-offset-2"
              >
                Ajouter un jeu
              </Link>
            </p>
          ) : (
            <form
              action={proposeGame}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row sm:items-end dark:bg-zinc-950"
            >
              <input type="hidden" name="sessionId" value={session.id} />
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-zinc-500" htmlFor="gameId">
                  Jeu
                </label>
                <select
                  id="gameId"
                  name="gameId"
                  required
                  className="rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {availableGames.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-full bg-zinc-950 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 sm:w-auto sm:text-sm dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Proposer
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
