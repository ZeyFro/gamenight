import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { pageMetadata } from "@/lib/page-title";
import { getTowerProposalOverview, getTowerProposalsCommunityId } from "@/lib/tower-challenge-proposals";
import { TOWER_PROPOSALS_MAX_PENDING, TOWER_PROPOSALS_PER_DAY } from "@/lib/tower-challenge-proposal-rules";
import { proposeTowerChallengeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Proposer un défi · The Tower");

const RESULTS: Record<string, string> = {
  SUBMITTED: "Proposition envoyée au staff. Elle n’entre au catalogue qu’après validation.", DUPLICATE: "Un défi ou une proposition en attente porte déjà ce titre.",
  not_ranker: "Il faut être Ranker (30 étages gagnés) pour proposer un défi.", daily_limit: `Déjà ${TOWER_PROPOSALS_PER_DAY} propositions sur les dernières 24 h.`,
  pending_limit: `Déjà ${TOWER_PROPOSALS_MAX_PENDING} propositions en attente.`, INVALID: "Titre (1 à 120 caractères), consigne (1 à 1500) et 1 à 3 étages requis.",
  RATE: "Trop de demandes, réessaie dans une minute.", UNAVAILABLE: "Cette fonctionnalité n’est pas disponible dans ta communauté.",
};
const STATUS = { PENDING: "En attente", APPROVED: "Acceptée", REJECTED: "Refusée" } as const;
const day = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });

export default async function TowerProposalsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await getTowerProposalsCommunityId(user.id);
  if (!communityId) notFound();
  const [{ result }, overview] = await Promise.all([searchParams, getTowerProposalOverview({ communityId, userId: user.id })]);
  if (overview.status !== "OVERVIEW") notFound();
  return <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <Link href="/tower" className="text-sm text-accent underline-offset-4 hover:underline">← The Tower</Link>
    <header>
      <h1 className="text-2xl font-semibold text-foreground">Proposer un défi</h1>
      <p className="mt-2 text-sm text-muted">Les joueurs Ranker et High Ranker peuvent proposer des défis solo. Le staff relit chaque proposition avant son entrée au catalogue ; aucune IA n’intervient. Barème : facile +1, moyen +2, difficile +3 étages.</p>
    </header>
    {result && RESULTS[result] ? <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p> : null}
    {overview.eligible ? <Card>
      <form action={proposeTowerChallengeAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-foreground">Titre
          <input name="title" required maxLength={120} className="min-h-11 rounded-lg border border-border bg-surface px-3 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">Consigne
          <textarea name="instructions" required maxLength={1500} rows={6} className="rounded-lg border border-border bg-surface px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">Difficulté
          <select name="rewardFloors" defaultValue="1" className="min-h-11 rounded-lg border border-border bg-surface px-3 text-base">
            <option value="1">Facile · +1 étage</option><option value="2">Moyen · +2 étages</option><option value="3">Difficile · +3 étages</option>
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={overview.block !== null}>Envoyer au staff</Button>
        {overview.block ? <p className="text-sm text-muted">{RESULTS[overview.block]}</p> : null}
      </form>
    </Card> : <Card><p className="text-sm text-muted">{RESULTS.not_ranker}</p></Card>}
    <Card>
      <h2 className="text-lg font-semibold text-foreground">Tes propositions</h2>
      {overview.mine.length ? <ul className="mt-3 flex flex-col gap-2 text-sm">
        {overview.mine.map(item => <li key={item.id} className="border-t border-border pt-2 text-foreground">
          {item.title} · +{item.rewardFloors} · {STATUS[item.status]} <span className="text-muted">({day.format(item.createdAt)})</span>
          {item.decisionNote ? <p className="text-muted">Note du staff : {item.decisionNote}</p> : null}
        </li>)}
      </ul> : <p className="mt-3 text-sm text-muted">Aucune proposition pour l’instant.</p>}
    </Card>
  </main>;
}
