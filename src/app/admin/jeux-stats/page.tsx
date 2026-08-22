import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";

/**
 * Liste des jeux de la bibliothèque commune, point d'entrée vers la
 * config par jeu (`/admin/jeux-stats/[gameId]`). Même esprit que
 * `/admin/messages` : "admin" au sens large, pas de rôle dédié, tout
 * utilisateur connecté peut configurer.
 */
export default async function JeuxStatsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const games = await prisma.game.findMany({
    where: { userGames: { some: { owned: true } } },
    include: { _count: { select: { statTypes: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Stats &amp; superlatifs
        </h1>
        <p className="mt-1 text-sm text-muted">
          Configure les stats saisissables après une soirée (nombre de
          morts, score…) et les superlatifs qu&apos;elles peuvent débloquer
          pour chaque jeu de la bibliothèque commune. Pas de rôle admin
          dédié : tout le monde peut gérer cette liste.
        </p>
      </div>

      {games.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Aucun jeu dans la bibliothèque commune pour l&apos;instant.
          </p>
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-3">
          {games.map((game) => (
            <StaggerItem key={game.id}>
              <Link
                href={`/admin/jeux-stats/${game.id}`}
                className="card-glow flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition-all duration-200"
              >
                <span className="font-medium text-foreground">
                  {game.name}
                </span>
                <Badge tone={game._count.statTypes > 0 ? "accent" : "neutral"}>
                  {game._count.statTypes} stat
                  {game._count.statTypes > 1 ? "s" : ""}
                </Badge>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
