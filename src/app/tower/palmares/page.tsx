import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { pageMetadata } from "@/lib/page-title";
import { getTowerSeasonPodium } from "@/lib/tower-season-podium";

export const metadata = pageMetadata("Palmarès The Tower");

export default async function TowerSeasonPodiumPage() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await resolveActiveCommunityId(user.id);
  const result = communityId ? await getTowerSeasonPodium({ userId: user.id, communityId }) : null;
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <Link href="/tower" className="text-sm text-accent underline-offset-4 hover:underline">← The Tower</Link>
    <header>
      <h1 className="text-3xl font-bold text-foreground">Palmarès de la dernière saison</h1>
      <p className="mt-2 text-muted">Les trois premiers parmi les membres actifs de ton serveur.</p>
    </header>
    {result?.status === "PODIUM" ? <>
      <Card>
        <h2 className="text-xl font-semibold text-foreground">{result.season.name}</h2>
        <p className="mt-2 text-sm text-muted">À partir du {date.format(result.season.startAt)}, jusqu’au {date.format(new Date(result.season.endAt.getTime() - 1))} inclus, heure de Paris.</p>
        <p className="mt-2 text-sm text-muted">Départage : étages remportés, puis défis difficiles réussis, puis premier joueur arrivé à ce total.</p>
      </Card>
      {result.entries.length ? <ol className="flex flex-col gap-4" aria-label="Podium de la saison terminée">
        {result.entries.map(entry => <li key={entry.rank}>
          <Card>
            <h3 className="text-lg font-semibold text-foreground"><span aria-hidden="true">{["🥇", "🥈", "🥉"][entry.rank - 1]} </span>{entry.rank}. {entry.displayName}</h3>
            <p className="mt-2 text-muted">{entry.rewardFloors} étage(s) remporté(s) · {entry.difficultWins} défi(s) difficile(s) réussi(s)</p>
          </Card>
        </li>)}
      </ol> : <Card><p className="text-muted">Aucune récompense créditée aux membres actifs pendant cette saison.</p></Card>}
    </> : <Card><p className="text-muted">Le palmarès n’est pas disponible pour la communauté sélectionnée.</p></Card>}
  </div>;
}
