import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { pageMetadata } from "@/lib/page-title";
import { getTowerSeasonProposal } from "@/lib/tower-season-proposal";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Proposition de palmarès The Tower · Admin");

const day = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });
const moment = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" });
const MEMBERSHIP_LABEL = { LEFT: "a quitté le serveur", REMOVED: "retiré du serveur" } as const;

/**
 * Proposition de palmarès d'une saison Tower finie, réservée aux administrateurs de la communauté.
 * Lecture seule : aucune publication, attribution ni écriture depuis cette page.
 */
export default async function TowerPalmaresProposalPage({ searchParams }: { searchParams: Promise<{ saison?: string | string[] }> }) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) return <div className="mx-auto max-w-4xl px-4 py-8"><Card>Choisis une communauté active pour consulter la proposition de palmarès.</Card></div>;
  const { saison } = await searchParams;
  const seasonStart = typeof saison === "string" && saison ? saison : undefined;
  const proposal = await getTowerSeasonProposal({ userId: user.id, communityId, ...(seasonStart ? { seasonStart } : {}) });
  if (proposal.status === "FORBIDDEN" || proposal.status === "INVALID" || proposal.status === "UNKNOWN_SEASON") notFound();
  if (proposal.status !== "PROPOSAL") return <div className="mx-auto max-w-4xl px-4 py-8"><Card>La proposition de palmarès n’est pas disponible pour cette communauté.</Card></div>;

  const { season } = proposal;
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <Link href="/tower/palmares" className="text-sm text-accent underline-offset-4 hover:underline">← Palmarès The Tower</Link>
    <header>
      <p className="text-sm font-medium uppercase tracking-wide text-accent">{proposal.communityName}</p>
      <h1 className="mt-1 text-3xl font-bold text-foreground">Proposition de palmarès</h1>
      <p className="mt-2 text-sm text-muted">Calcul automatique à partir des défis validés, à relire avant toute annonce. Cette page ne publie rien, n’attribue aucun titre ni badge et n’enregistre rien.</p>
    </header>

    <nav aria-label="Saisons terminées">
      <ul className="flex flex-wrap gap-2">
        {proposal.seasons.map(item => {
          const current = item.startAt.getTime() === season.startAt.getTime();
          return <li key={item.startAt.toISOString()}>
            <Link href={`/admin/tower-palmares?saison=${encodeURIComponent(item.startAt.toISOString())}`} aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${current ? "border-accent text-accent" : "border-border text-foreground hover:border-border-hover"}`}>
              {item.name}
            </Link>
          </li>;
        })}
      </ul>
    </nav>

    <Card>
      <h2 className="text-xl font-semibold text-foreground">{season.name}</h2>
      <p className="mt-2 text-sm text-muted">Du {day.format(season.startAt)} au {day.format(new Date(season.endAt.getTime() - 1))} inclus, heure de Paris. Un étage compte pour la saison de la date où il a été crédité.</p>
      <p className="mt-2 text-sm text-muted">{proposal.creditedFloors} étage(s) crédité(s) à {proposal.creditedPlayers} joueur(s) pendant cette saison.</p>
      {proposal.completed ? null : <p className="mt-2 font-medium text-foreground">Aucun étage crédité pendant cette saison : elle ne compte pas comme terminée et n’a pas de palmarès.</p>}
      {proposal.truncated ? <p className="mt-2 font-medium text-foreground">Classement trop long pour être lu en entier : cette proposition est incomplète et ne doit pas être utilisée telle quelle.</p> : null}
      <p className="mt-2 text-sm text-muted">Calculé le {moment.format(proposal.computedAt)} (heure de Paris).</p>
    </Card>

    {proposal.candidates.length ? <Card>
      <h2 className="text-xl font-semibold text-foreground">Membres actifs classés</h2>
      <p className="mt-2 text-sm text-muted">Départage : étages remportés, puis défis à 3 étages, puis premier arrivé à ce total. Les joueurs strictement à égalité partagent la même place (co-lauréats) ; aucun n’est écarté.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">Classement proposé pour {season.name}</caption>
          <thead className="text-muted">
            <tr><th scope="col" className="py-2 pr-4 font-medium">Place</th><th scope="col" className="py-2 pr-4 font-medium">Joueur</th><th scope="col" className="py-2 pr-4 font-medium">Étages</th><th scope="col" className="py-2 pr-4 font-medium">Défis à 3 étages</th><th scope="col" className="py-2 font-medium">Total atteint le</th></tr>
          </thead>
          <tbody>
            {proposal.candidates.map((entry, index) => <tr key={index} className="border-t border-border">
              <td className="py-2 pr-4 text-foreground">{entry.place}{entry.exAequo ? " ex æquo" : ""}{entry.onPodium ? <span className="text-muted"> · podium</span> : null}</td>
              <th scope="row" className="py-2 pr-4 font-medium text-foreground">{entry.displayName}</th>
              <td className="py-2 pr-4 text-foreground">{entry.rewardFloors}</td>
              <td className="py-2 pr-4 text-foreground">{entry.difficultWins}</td>
              <td className="py-2 text-foreground">{moment.format(entry.reachedAt)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </Card> : proposal.completed ? <Card><p className="text-muted">Aucun membre encore actif n’a été crédité pendant cette saison.</p></Card> : null}

    {proposal.formerMembers.length ? <Card>
      <h2 className="text-xl font-semibold text-foreground">Crédités, mais plus membres actifs</h2>
      <p className="mt-2 text-sm text-muted">Ces joueurs ne sont pas classés ci-dessus. Leur présence au palmarès reste à décider avant toute annonce.</p>
      <ul className="mt-4 flex flex-col gap-2 text-sm">
        {proposal.formerMembers.map((entry, index) => <li key={index} className="border-t border-border pt-2 text-foreground">
          {entry.displayName} · {entry.rewardFloors} étage(s) · {entry.difficultWins} défi(s) à 3 étages · total atteint le {moment.format(entry.reachedAt)}
          <span className="text-muted"> ({entry.membershipStatus ? MEMBERSHIP_LABEL[entry.membershipStatus as keyof typeof MEMBERSHIP_LABEL] ?? "plus membre actif" : "n’est plus membre"})</span>
        </li>)}
      </ul>
    </Card> : null}
  </div>;
}
