import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { pageMetadata } from "@/lib/page-title";
import { getTowerProposalsCommunityId, listPendingTowerProposals } from "@/lib/tower-challenge-proposals";
import { decideTowerProposalAction } from "@/app/tower/propositions/actions";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Propositions de défis · Admin");

const RESULTS: Record<string, string> = {
  APPROVED: "Proposition acceptée : le défi est au catalogue solo.", REJECTED: "Proposition refusée.",
  DUPLICATE: "Un défi actif porte déjà ce titre : refuse la proposition ou désactive l’ancien défi.",
  ALREADY_DECIDED: "Cette proposition a déjà été traitée.", NOT_FOUND: "Proposition introuvable.", FORBIDDEN: "Réservé au staff de la communauté.",
  INVALID: "Demande invalide.", RATE: "Trop de demandes, réessaie dans une minute.", UNAVAILABLE: "Cette fonctionnalité n’est pas disponible dans ta communauté.",
};

/** File de validation du staff : une proposition n'entre au catalogue qu'après approbation d'un OWNER/ADMIN. */
export default async function TowerProposalsAdminPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await getTowerProposalsCommunityId(user.id);
  if (!communityId) notFound();
  const [{ result }, queue] = await Promise.all([searchParams, listPendingTowerProposals({ communityId, userId: user.id })]);
  if (queue.status !== "PENDING_LIST") notFound();
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <Link href="/tower" className="text-sm text-accent underline-offset-4 hover:underline">← The Tower</Link>
    <h1 className="text-2xl font-semibold text-foreground">Propositions de défis</h1>
    {result && RESULTS[result] ? <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p> : null}
    {queue.proposals.length ? queue.proposals.map(item => <Card key={item.id} className="flex flex-col gap-2">
      <h2 className="font-semibold text-foreground">{item.title} · +{item.rewardFloors} étage(s)</h2>
      <p className="text-xs text-muted">Proposé par {item.proposer.discordName}</p>
      <p className="whitespace-pre-wrap text-sm text-foreground">{item.instructions}</p>
      <form action={decideTowerProposalAction} className="flex flex-col gap-2">
        <input type="hidden" name="proposalId" value={item.id} />
        <label className="flex flex-col gap-1 text-sm text-foreground">Note (facultative, visible du joueur)
          <input name="note" maxLength={500} className="min-h-11 rounded-lg border border-border bg-surface px-3 text-base" />
        </label>
        <div className="flex gap-2">
          <Button type="submit" name="decision" value="approve" variant="primary" size="sm">Accepter</Button>
          <Button type="submit" name="decision" value="reject" variant="destructive" size="sm">Refuser</Button>
        </div>
      </form>
    </Card>) : <Card><p className="text-sm text-muted">Aucune proposition en attente.</p></Card>}
  </main>;
}
