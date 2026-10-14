import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { FadeInView } from "@/components/ui/FadeInView";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Mes saisons");

/** Onglet "Saisons" du profil — résultats passés de l'utilisateur, saison par saison. */
export default async function ProfilSaisonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const communityId = await writeCommunityIdForUser(user.id);
  const snapshots = await prisma.seasonSnapshot.findMany({
    where: { userId: user.id, season: { communityId: { in: communityId ? [communityId] : [] } } },
    include: { season: true },
    orderBy: { season: { number: "desc" } },
  });

  if (snapshots.length === 0) {
    return (
      <FadeInView>
        <Card>
          <p className="text-sm text-muted">
            Aucune saison terminée pour l&apos;instant — reviens à la fin du mois.
          </p>
        </Card>
      </FadeInView>
    );
  }

  return (
    <FadeInView className="flex flex-col gap-2">
      {snapshots.map((snap) => (
        <Card key={snap.id} className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-medium text-foreground">
              {snap.season.name}
              {snap.position === 1 && <span title="Champion">🏆</span>}
            </p>
            <p className="text-xs text-muted">
              {snap.rank} · niveau {snap.level}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold text-foreground">#{snap.position}</p>
            <p className="text-xs text-muted">{snap.xp} XP</p>
          </div>
        </Card>
      ))}
    </FadeInView>
  );
}
