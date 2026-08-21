import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { todayDateOnly } from "@/lib/wallclock";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ReadOnlyGameGrid } from "@/components/ReadOnlyGameGrid";
import { AvailabilityView } from "@/components/AvailabilityView";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export default async function PoteLibraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  // Sa propre carte n'apparaît pas dans /potes, mais on couvre quand même
  // le cas (lien direct, avatar cliqué depuis la biblio de groupe) plutôt
  // que d'afficher une biblio "en lecture seule" de soi-même.
  if (id === user.id) redirect("/bibliotheque");

  const pote = await prisma.user.findUnique({ where: { id } });
  if (!pote) notFound();

  const today = todayDateOnly();
  const [userGames, weeklySlots, overrides] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId: id, owned: true },
      include: { game: true },
      orderBy: { game: { name: "asc" } },
    }),
    prisma.weeklyAvailability.findMany({
      where: { userId: id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    prisma.availabilityOverride.findMany({
      where: {
        userId: id,
        date: { gte: today, lte: new Date(today.getTime() + FOURTEEN_DAYS_MS) },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const games = userGames.map(({ game }) => ({
    id: game.id,
    name: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    isCoop: game.isCoop,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
  }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link
          href="/potes"
          className="text-sm text-muted hover:text-foreground hover:underline"
        >
          ← Potes
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <Avatar src={pote.discordAvatar} alt={pote.discordName} size={48} />
          <div>
            <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
              {pote.discordName}
            </h1>
            <Badge tone={pote.steamId64 ? "accent" : "neutral"}>
              {pote.steamId64 ? "Steam lié" : "Steam non lié"}
            </Badge>
          </div>
        </div>
      </div>

      <ReadOnlyGameGrid
        games={games}
        emptyMessage={`${pote.discordName} n'a pas encore de jeu dans sa bibliothèque.`}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Dispos</h2>
        <AvailabilityView weeklySlots={weeklySlots} overrides={overrides} />
      </section>
    </div>
  );
}
