import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";

/**
 * Onglet "Jeux-stats" du hub /admin — contenu déplacé depuis l'ancien
 * `/admin/jeux-stats`. Chantier dormant depuis PR 5/9 (remplacé par le
 * vote de superlatifs), laissé fonctionnel — voir le commentaire sur
 * `GameStatType` dans schema.prisma. `/admin/jeux-stats/[gameId]` (CRUD
 * détaillé par jeu) reste une vraie route indépendante, pas absorbée
 * dans le hub : seule la page d'index l'était.
 */
export async function JeuxStatsTab() {
  const games = await prisma.game.findMany({
    where: { userGames: { some: { owned: true } } },
    include: { _count: { select: { statTypes: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Configure les stats saisissables après une soirée (nombre de
        morts, score…) et les superlatifs qu&apos;elles peuvent débloquer
        pour chaque jeu de la bibliothèque commune. Chantier dormant
        depuis PR 5/9 (remplacé par le vote de superlatifs ci-dessus),
        laissé fonctionnel.
      </p>

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
                <span className="font-medium text-foreground">{game.name}</span>
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
