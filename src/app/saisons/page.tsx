import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { getSeasonProgress } from "@/lib/seasons";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Stagger, StaggerItem } from "@/components/motion";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Saisons");

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Sprint 4 (FEATURE 3, Saisons mensuelles) — historique des saisons
 * terminées avec podium (top 3, `SeasonSnapshot.position`). Avatar/couleur
 * relus en direct sur `User` (pas figés dans le snapshot, cosmétique
 * uniquement — seuls xp/level/rank/position sont historiques).
 */
export default async function SaisonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const scopedDb = await getActiveScopedPrisma(user.id);
  const [progress, pastSeasons] = await Promise.all([
    getSeasonProgress(user.id),
    scopedDb.season.findMany({
      where: { isActive: false },
      orderBy: { number: "desc" },
      include: {
        snapshots: {
          where: { position: { lte: 3 } },
          orderBy: { position: "asc" },
          include: { user: { select: { discordName: true, discordAvatar: true, color: true } } },
        },
      },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Saisons</h1>
        {progress && (
          <p className="mt-1 text-sm text-muted">
            {progress.name} en cours — jour {progress.dayOfMonth}/{progress.totalDays}
          </p>
        )}
      </div>

      {pastSeasons.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Aucune saison terminée pour l&apos;instant — reviens à la fin du mois.
          </p>
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-4">
          {pastSeasons.map((season) => (
            <StaggerItem key={season.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-foreground">{season.name}</h2>
                  <Link
                    href={`/profil/saisons`}
                    className="text-xs text-accent hover:underline"
                  >
                    Mon résultat →
                  </Link>
                </div>
                <div className="flex flex-col gap-2">
                  {season.snapshots.map((snap, i) => (
                    <div key={snap.id} className="flex items-center gap-3">
                      <span className="w-6 text-center text-lg" aria-hidden>
                        {MEDALS[i]}
                      </span>
                      <Avatar
                        src={snap.user.discordAvatar}
                        alt={snap.user.discordName}
                        size={32}
                        ringColor={snap.user.color}
                      />
                      <p className="flex-1 truncate text-sm font-medium text-foreground">
                        {snap.user.discordName}
                      </p>
                      <p className="text-xs text-muted">{snap.xp} XP</p>
                    </div>
                  ))}
                </div>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
