import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import {
  SessionResultsForm,
  type ResultParticipant,
} from "@/components/SessionResultsForm";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Résultats de la soirée");

const PLACEMENT_LABELS: Record<number, string> = {
  1: "🥇 1er",
  2: "🥈 2e",
  3: "🥉 3e",
};

/**
 * Saisie/consultation des résultats d'une soirée (Axe 2) — réservée au
 * créateur (garde ici, et re-vérifiée dans `submitSessionResultsAction`).
 * Page dédiée plutôt qu'une modal comme `EditSessionDialog`/
 * `DeleteSessionDialog` : le formulaire va grandir en PR 5/9 avec les
 * champs de stats par jeu (superlatifs), une modal serait vite à
 * l'étroit sur mobile.
 */
export default async function SessionResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      decidedGame: true,
      results: { include: { user: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!session) notFound();
  if (session.createdById !== user.id) redirect(`/sessions/${id}`);
  if (
    session.status !== "DONE" ||
    !session.decidedGameId ||
    !session.decidedGame
  ) {
    redirect(`/sessions/${id}`);
  }

  const alreadySubmitted = session.results.length > 0;

  let participants: ResultParticipant[] = [];
  if (!alreadySubmitted) {
    const winningProposal = await prisma.proposal.findFirst({
      where: { sessionId: id, gameId: session.decidedGameId },
      include: { votes: { include: { user: true } } },
    });
    participants =
      winningProposal?.votes.map((v) => ({
        id: v.user.id,
        discordName: v.user.discordName,
        discordAvatar: v.user.discordAvatar,
      })) ?? [];
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
          Résultats — {session.decidedGame.name}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateTimeFr(session.date)}
        </p>
      </div>

      {alreadySubmitted ? (
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Résultats déjà enregistrés — pas de ré-édition possible.
          </p>
          <ul className="flex flex-col gap-2">
            {[...session.results]
              .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
              .map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
                >
                  <Avatar
                    src={r.user.discordAvatar}
                    alt={r.user.discordName}
                    size={32}
                  />
                  <span className="flex-1 text-sm text-foreground">
                    {r.user.discordName}
                  </span>
                  {r.placement && (
                    <Badge tone="accent">{PLACEMENT_LABELS[r.placement]}</Badge>
                  )}
                </li>
              ))}
          </ul>
        </Card>
      ) : participants.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Personne n&apos;a voté pour {session.decidedGame.name} — rien à
            saisir.
          </p>
        </Card>
      ) : (
        <Card>
          <SessionResultsForm
            sessionId={id}
            participants={participants}
            isCoop={session.decidedGame.isCoop}
          />
        </Card>
      )}
    </div>
  );
}
