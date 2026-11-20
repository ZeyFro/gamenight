import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { pageMetadata } from "@/lib/page-title";
import { getTowerIrregularCommunityId, listTowerIrregularForStaff } from "@/lib/tower-irregular";
import { grantTowerIrregularAction, revokeTowerIrregularAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Irregular The Tower · Admin");

const RESULTS: Record<string, string> = {
  granted: "Irregular attribué.", revoked: "Irregular retiré.", already: "Ce joueur est déjà Irregular.",
  not_granted: "Ce joueur n’est pas Irregular.", forbidden: "Réservé au staff de la communauté (propriétaire ou administrateur).",
  not_member: "Ce joueur n’est pas un membre actif de la communauté.", invalid: "Demande invalide.",
  rate: "Trop de demandes, réessaie dans une minute.", unavailable: "Cette fonctionnalité n’est pas disponible dans ta communauté.",
};
const moment = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

/**
 * Attribution manuelle d'Irregular (cahier 6.1) : réservée aux OWNER/ADMIN de la communauté. Pur prestige :
 * aucun droit de modération, aucun rôle Discord, aucune notification. Un grade gagné (Ranker, High Ranker)
 * l'emporte toujours sur Irregular à l'affichage.
 */
export default async function TowerIrregularAdminPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await getTowerIrregularCommunityId(user.id);
  if (!communityId) notFound();
  const [{ result }, data] = await Promise.all([searchParams, listTowerIrregularForStaff(user.id, communityId)]);
  if (data.status !== "LISTED") notFound();
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <Link href="/tower" className="text-sm text-accent underline-offset-4 hover:underline">← The Tower</Link>
    <header>
      <h1 className="text-2xl font-semibold text-foreground">Irregular · attribution manuelle</h1>
      <p className="mt-2 text-sm text-muted">Irregular est un grade de prestige décidé par le staff. Il ne donne aucun droit de modération et ne change aucun rôle Discord. Un grade gagné (Ranker, High Ranker) l’emporte toujours.</p>
    </header>
    {result && RESULTS[result] ? <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p> : null}
    <Card>
      <h2 className="text-lg font-semibold text-foreground">Membres actifs</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {data.members.map(member => <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm">
          <span className="text-foreground">{member.displayName}{member.grantedAt ? <span className="text-muted"> · Irregular depuis le {moment.format(member.grantedAt)}</span> : null}</span>
          <form action={member.grantedAt ? revokeTowerIrregularAction : grantTowerIrregularAction}>
            <input type="hidden" name="userId" value={member.userId} />
            <Button type="submit" size="sm" variant={member.grantedAt ? "secondary" : "primary"}>{member.grantedAt ? "Retirer" : "Attribuer"}</Button>
          </form>
        </li>)}
      </ul>
    </Card>
    <Card>
      <h2 className="text-lg font-semibold text-foreground">Journal récent</h2>
      {data.log.length ? <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">
        {data.log.map(entry => <li key={entry.id}>{moment.format(entry.createdAt)} · {entry.action === "GRANTED" ? "attribué à" : "retiré à"} {entry.displayName}{entry.actorName ? ` par ${entry.actorName}` : ""}</li>)}
      </ul> : <p className="mt-3 text-sm text-muted">Aucun mouvement pour l’instant.</p>}
    </Card>
  </main>;
}
