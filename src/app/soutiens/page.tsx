import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { boostersEnabled, loadSupportWall } from "@/lib/booster-support";
import { BOOSTER_BADGE_LABEL, BOOSTER_FORBIDDEN } from "@/lib/boost-perks";
import { formatDateFr } from "@/lib/wallclock";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Mur des soutiens");

/** Mur des soutiens : reconnaissance cosmétique des membres qui boostent le serveur Discord. */
export default async function SupportWallPage() {
  if (!boostersEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await resolveActiveCommunityId(user.id);
  const membership = communityId ? await findActiveMembership(user.id, communityId) : null;
  if (!communityId || !membership) notFound();

  const wall = await loadSupportWall(communityId);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">💜 Mur des soutiens</h1>
        <p className="mt-1 text-sm text-muted">
          Merci aux membres qui boostent le serveur Discord. Distinction « {BOOSTER_BADGE_LABEL} », rôle « Soutien de la Tour » et salons réservés : uniquement de la reconnaissance, aucun avantage de jeu.
        </p>
      </div>
      {wall.length === 0 ? (
        <EmptyState icon="💜" title="Aucun soutien pour le moment : le mur se remplit quand des membres boostent le serveur." />
      ) : (
        <ul className="flex flex-col gap-3">
          {wall.map((entry) => (
            <li key={entry.userId}>
              <Card className="flex items-center gap-3">
                <Avatar src={entry.image} alt={entry.name} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                  {entry.since && <p className="text-xs text-muted">Soutien depuis le {formatDateFr(entry.since)}</p>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card className="text-xs text-muted">
        <p className="font-medium text-foreground">Ce que le boost ne donne jamais</p>
        <ul className="mt-1 list-disc pl-5">
          {BOOSTER_FORBIDDEN.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </Card>
    </main>
  );
}
