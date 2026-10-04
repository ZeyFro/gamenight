import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { spinRouletteIfDue, isRouletteProposalOpen } from "@/lib/roulette";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { RouletteCountdown } from "@/components/roulette/RouletteCountdown";
import { RouletteEntryForm } from "@/components/roulette/RouletteEntryForm";
import { RouletteResultReveal } from "@/components/roulette/RouletteResultReveal";
import { forceSpinRouletteAction } from "@/app/roulette/actions";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Roulette");

/**
 * Page de propositions d'une roulette async (FIX Sprint 3). Le tirage est
 * paresseux comme partout ailleurs dans l'app (`spinRouletteIfDue`, même
 * contrat que `closeSessionIfDue` sur `/sessions/[id]`) : visiter cette
 * page après la deadline peut, elle-même, déclencher le tirage.
 *
 * Tant que `status === "OPEN"`, les jeux proposés par les AUTRES ne sont
 * jamais chargés ni envoyés au client (seul un COMPTE) — l'effet
 * "surprise" tient à ce que la liste des jeux d'autrui ne transite jamais
 * dans le payload de la page, pas juste à ce qu'elle ne soit pas affichée.
 */
export default async function RouletteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  await spinRouletteIfDue(id);

  const roulette = await prisma.roulette.findUnique({
    where: { id },
    select: {
      id: true,
      createdById: true,
      scheduledAt: true,
      deadline: true,
      status: true,
      resultGameId: true,
      resultSessionId: true,
      notifiedUserIds: true,
      createdBy: { select: { discordName: true } },
    },
  });
  if (!roulette) notFound();

  const isCreator = roulette.createdById === user.id;
  const proposalOpen = isRouletteProposalOpen(roulette);
  const invitedIds = resolveNotifiedUserIds(roulette.notifiedUserIds) ?? [];

  // Confidentialité — une roulette n'a pas encore de table d'invitation
  // dédiée (voir le commentaire de `EnCoursTab`, /roulette/page.tsx) :
  // accès réservé au créateur et aux ids listés dans `notifiedUserIds`.
  // `notFound()` plutôt qu'un message explicite, même raisonnement que
  // `/sessions/[id]` — jamais confirmer l'existence d'une roulette à un
  // non-invité.
  if (!isCreator && !invitedIds.includes(user.id)) notFound();

  const [invited, myEntries] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: invitedIds } },
      select: { id: true, discordName: true, discordAvatar: true, color: true },
    }),
    prisma.rouletteEntry.findMany({
      where: { rouletteId: id, userId: user.id },
      select: { game: { select: { id: true, name: true, coverUrl: true } } },
    }),
  ]);

  // Uniquement les userId (jamais les jeux) des autres — le compteur
  // "X/Y ont proposé" a besoin de savoir QUI, pas QUOI.
  const entryUserCounts =
    roulette.status === "OPEN"
      ? await prisma.rouletteEntry.groupBy({
          by: ["userId"],
          where: { rouletteId: id },
          _count: { _all: true },
        })
      : [];
  const proposedUserIds = new Set(
    entryUserCounts.filter((e) => e._count._all >= 2).map((e) => e.userId)
  );

  let fullEntries: { userId: string; game: { id: string; name: string } }[] = [];
  let resultGame: { name: string; coverUrl: string | null } | null = null;
  if (roulette.status === "DONE" && roulette.resultGameId) {
    const [entries, game] = await Promise.all([
      prisma.rouletteEntry.findMany({
        where: { rouletteId: id },
        select: { userId: true, game: { select: { id: true, name: true } } },
      }),
      prisma.game.findUnique({
        where: { id: roulette.resultGameId },
        select: { name: true, coverUrl: true },
      }),
    ]);
    fullEntries = entries;
    resultGame = game;
  }

  const myGamesRaw = await prisma.userGame.findMany({
    where: { userId: user.id, owned: true },
    select: { game: { select: { id: true, name: true, coverUrl: true } } },
    orderBy: { game: { name: "asc" } },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link href="/roulette" className="text-sm text-muted hover:text-foreground hover:underline">
          ← Roulette
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">
          🎰 Roulette du {formatDateTimeFr(roulette.scheduledAt)}
        </h1>
        <p className="text-sm text-muted">Créée par {roulette.createdBy.discordName}</p>
      </div>

      {roulette.status === "OPEN" && (
        <>
          <Card className="flex flex-col gap-2">
            <RouletteCountdown deadline={roulette.deadline.toISOString()} />
            <p className="text-sm text-muted">
              {proposedUserIds.size}/{invited.length} ont proposé leurs jeux
            </p>
            <div className="flex flex-wrap gap-2">
              {invited.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs ${
                    proposedUserIds.has(p.id)
                      ? "border-accent/40 bg-accent/10 text-foreground"
                      : "border-border bg-background text-muted"
                  }`}
                >
                  <Avatar src={p.discordAvatar} alt={p.discordName} size={20} />
                  {p.discordName}
                  {proposedUserIds.has(p.id) && " ✓"}
                </div>
              ))}
            </div>
          </Card>

          {proposalOpen ? (
            <RouletteEntryForm
              rouletteId={roulette.id}
              myGames={myGamesRaw.map((g) => g.game)}
              initialSelection={myEntries.map((e) => e.game)}
            />
          ) : (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Les propositions sont fermées, le tirage va se lancer.
            </p>
          )}

          {isCreator && (
            <form action={forceSpinRouletteAction}>
              <input type="hidden" name="rouletteId" value={roulette.id} />
              <Button type="submit" variant="secondary" fullWidthOnMobile>
                Lancer la roue maintenant
              </Button>
            </form>
          )}
        </>
      )}

      {roulette.status === "SPINNING" && (
        <Card>
          <p className="text-sm text-muted">La roue tourne…</p>
        </Card>
      )}

      {roulette.status === "DONE" && resultGame && roulette.resultSessionId && (
        <RouletteResultReveal
          entries={fullEntries}
          winnerGameId={roulette.resultGameId!}
          winnerGameName={resultGame.name}
          winnerGameCoverUrl={resultGame.coverUrl}
          sessionId={roulette.resultSessionId}
          soundEnabled={user.soundEnabled}
        />
      )}

      {roulette.status === "DONE" && !roulette.resultGameId && (
        <Card>
          <p className="text-sm text-muted">
            ❌ Roulette annulée — pas assez de participants ont proposé leurs jeux.
          </p>
        </Card>
      )}
    </div>
  );
}
