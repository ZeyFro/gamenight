import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { listAvailabilityPolls } from "@/lib/session-availability-poll-data";
import { formatDateTimeFr } from "@/lib/wallclock";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Préparations de soirées" };

export default async function AvailabilityPollsPage() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const polls = await listAvailabilityPolls(user.id);
  return <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Préparer une soirée</h1><p className="text-sm text-muted">Comparez les créneaux avant de créer la soirée et ses invitations.</p></div><ButtonLink href="/sessions/sondages/nouveau" variant="primary">Nouveau sondage</ButtonLink></header>
    {polls.length === 0 ? <Card><p className="text-sm text-muted">Aucun sondage accessible pour le moment.</p></Card> : <ul className="grid gap-3">{polls.map(poll => <li key={poll.id}><Link href={`/sessions/sondages/${poll.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-accent"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{poll.title}</h2><span className="text-xs text-muted">{poll.status === "OPEN" ? "Ouvert" : poll.sessionId ? "Soirée créée" : "Clos"}</span></div><p className="mt-1 text-xs text-muted">Créé {formatDateTimeFr(poll.createdAt)}</p></Link></li>)}</ul>}
    <Link href="/sessions" className="text-sm text-accent hover:underline">← Retour aux soirées</Link>
  </main>;
}
