import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { pageMetadata } from "@/lib/page-title";
import { getTowerSeasonPodium } from "@/lib/tower-season-podium";
import { getTowerPersonalProgress } from "@/lib/tower-personal-progress";
import type { TowerRankStep } from "@/lib/tower-ranks";
import { TowerRankBadge } from "@/components/TowerRankBadge";

export const metadata = pageMetadata("Palmarès The Tower");

function nextRankText(next: TowerRankStep): string {
  const floors = next.floorsMissing === "0" ? null : `${next.floorsMissing} étage(s) à gagner`;
  const season = next.seasonMissing ? "une saison terminée" : null;
  return `Prochain rang, ${next.rank} : encore ${[floors, season].filter(Boolean).join(" et ")}.`;
}

export default async function TowerSeasonPodiumPage() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await resolveActiveCommunityId(user.id);
  const result = communityId ? await getTowerSeasonPodium({ userId: user.id, communityId }) : null;
  const progress = communityId ? await getTowerPersonalProgress({ viewerId: user.id, memberId: user.id, communityId }) : null;
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <Link href="/tower" className="text-sm text-accent underline-offset-4 hover:underline">← The Tower</Link>
    <header>
      <h1 className="text-3xl font-bold text-foreground">Palmarès de la dernière saison</h1>
      <p className="mt-2 text-muted">Les trois premières places parmi les membres actifs de ton serveur. Les joueurs strictement à égalité partagent la même place.</p>
    </header>
    {progress?.status === "PROGRESS" ? <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-foreground">Ta progression</h2>
        <TowerRankBadge rank={progress.rank} />
      </div>
      <p className="mt-2 text-muted">{progress.floorsClimbed} étage(s) gagné(s) avec les défis · {progress.completedSeasons} saison(s) terminée(s)</p>
      <p className="mt-2 text-sm text-muted">{progress.next ? nextRankText(progress.next) : "Tu as atteint le rang le plus élevé."}</p>
      <p className="mt-2 text-sm text-muted">Le rang dépend uniquement des étages gagnés avec les défis, jamais de l’XP. Une saison compte comme terminée quand elle est finie et qu’au moins un étage t’y a été crédité.</p>
    </Card> : null}
    {result?.status === "PODIUM" ? <>
      <Card>
        <h2 className="text-xl font-semibold text-foreground">{result.season.name}</h2>
        <p className="mt-2 text-sm text-muted">À partir du {date.format(result.season.startAt)}, jusqu’au {date.format(new Date(result.season.endAt.getTime() - 1))} inclus, heure de Paris.</p>
        <p className="mt-2 text-sm text-muted">Départage : étages remportés, puis défis difficiles réussis, puis premier joueur arrivé à ce total.</p>
      </Card>
      {result.entries.length ? <ol className="flex flex-col gap-4" aria-label="Podium de la saison terminée">
        {result.entries.map((entry, index) => <li key={index}>
          <Card>
            <h3 className="text-lg font-semibold text-foreground"><span aria-hidden="true">{["🥇", "🥈", "🥉"][entry.rank - 1]} </span>{entry.rank}. {entry.displayName}{entry.exAequo ? <span className="text-sm font-normal text-muted"> (ex æquo)</span> : null}</h3>
            <p className="mt-2 text-muted">{entry.rewardFloors} étage(s) remporté(s) · {entry.difficultWins} défi(s) difficile(s) réussi(s)</p>
          </Card>
        </li>)}
      </ol> : <Card><p className="text-muted">Aucune récompense créditée aux membres actifs pendant cette saison.</p></Card>}
    </> : <Card><p className="text-muted">Le palmarès n’est pas disponible pour la communauté sélectionnée.</p></Card>}
  </main>;
}
