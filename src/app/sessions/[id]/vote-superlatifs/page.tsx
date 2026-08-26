import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatDateTimeFr } from "@/lib/wallclock";
import {
  finalizeSuperlativeVotingIfDue,
  getWinningProposalParticipants,
} from "@/lib/superlative-voting";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { SuperlativeVoteForm } from "@/components/SuperlativeVoteForm";
import { forceCloseSuperlativeVotingAction } from "../../actions";

/**
 * Vote de superlatifs entre potes (PR 5/9, version light) — page dédiée
 * plutôt qu'une modal, même rationale que `/sessions/[id]/resultats` :
 * plusieurs rangées (une par catégorie), à l'étroit dans une modal sur
 * mobile.
 *
 * `finalizeSuperlativeVotingIfDue` est appelée ici en lecture (clôture
 * paresseuse, même schéma que `closeSessionIfDue`) : ouvrir cette page
 * peut à elle seule déclencher le calcul des gagnants si la deadline est
 * dépassée, sans attendre qu'un cron ou un autre chargement de page s'en
 * charge.
 */
export default async function SuperlativeVotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  await finalizeSuperlativeVotingIfDue(id);

  const session = await prisma.session.findUnique({
    where: { id },
    include: { decidedGame: true },
  });
  if (!session) notFound();
  if (
    session.status !== "DONE" ||
    !session.decidedGameId ||
    !session.decidedGame
  ) {
    redirect(`/sessions/${id}`);
  }

  const isCreator = session.createdById === user.id;
  const participants = await getWinningProposalParticipants(
    id,
    session.decidedGameId
  );
  const isParticipant = participants.some((p) => p.id === user.id);

  let content: ReactNode;

  if (session.superlativeVotingClosed) {
    const awards = await prisma.superlativeAward.findMany({
      where: { sessionId: id },
      include: { category: true, winner: true },
      orderBy: { category: { name: "asc" } },
    });

    content = (
      <Card className="flex flex-col gap-3">
        {awards.length === 0 ? (
          <p className="text-sm text-muted">
            Personne n&apos;a voté pour cette soirée — pas d&apos;awards
            cette fois.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {awards.map((award) => (
              <li
                key={award.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
              >
                <Avatar
                  src={award.winner.discordAvatar}
                  alt={award.winner.discordName}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {award.category.icon} {award.category.name}
                  </p>
                  <p className="text-xs text-muted">
                    {award.winner.discordName} — {award.voteCount} voix
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  } else if (!isParticipant) {
    content = (
      <Card>
        <p className="text-sm text-muted">
          Tu n&apos;as pas participé à cette soirée — pas de vote pour toi
          ici.
        </p>
      </Card>
    );
  } else {
    const alreadyVoted =
      (await prisma.superlativeVote.count({
        where: { sessionId: id, voterUserId: user.id },
      })) > 0;

    if (alreadyVoted) {
      content = (
        <Card>
          <p className="text-sm text-muted">
            Vote enregistré — en attente des autres participants (ou de la
            deadline de 24h).
          </p>
        </Card>
      );
    } else {
      const categories = await prisma.superlativeCategory.findMany({
        where: { active: true },
        orderBy: { createdAt: "asc" },
      });

      content =
        categories.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Aucune récompense configurée pour l&apos;instant.
            </p>
          </Card>
        ) : (
          <Card>
            <SuperlativeVoteForm
              sessionId={id}
              voterId={user.id}
              participants={participants.map((p) => ({
                id: p.id,
                discordName: p.discordName,
                discordAvatar: p.discordAvatar,
              }))}
              categories={categories}
            />
          </Card>
        );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link
          href={`/sessions/${id}`}
          className="text-sm text-muted hover:text-foreground hover:underline"
        >
          ← Retour à la soirée
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">
          🏆 Récompenses — {session.decidedGame.name}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateTimeFr(session.date)}
        </p>
      </div>

      {content}

      {isCreator && !session.superlativeVotingClosed && (
        <form action={forceCloseSuperlativeVotingAction}>
          <input type="hidden" name="sessionId" value={id} />
          <Button type="submit" variant="secondary" size="sm">
            Forcer la clôture des votes maintenant
          </Button>
        </form>
      )}
    </div>
  );
}
