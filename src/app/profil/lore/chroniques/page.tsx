import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { listSessionChronicles } from "@/lib/session-chronicles";
import { pageMetadata } from "@/lib/page-title";
import { formatDateFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";

export const metadata = pageMetadata("Chroniques de soirée");

export default async function SessionChroniclesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const query = await searchParams;
  const page = query.page === undefined ? 1 : typeof query.page === "string" && /^\d+$/.test(query.page) ? Number(query.page) : NaN;
  const archive = await listSessionChronicles(user.id, page);
  if (!archive) notFound();
  return <div className="flex flex-col gap-4">
    <Link href="/profil/lore" className="inline-flex min-h-11 items-center text-sm text-accent">← Lore du groupe</Link>
    <header><h1 className="text-xl font-semibold">Chroniques · {archive.communityName}</h1><p className="mt-2 text-sm text-muted">Les souvenirs des soirées privées auxquelles tu as accès dans ce serveur.</p></header>
    {archive.items.length === 0 && <p className="text-sm text-muted">Aucune chronique sur cette page.</p>}
    {archive.items.map(item => <Card key={item.id}>
      <h2 className="font-semibold"><Link href={`/sessions/${item.id}`} className="text-accent">{item.decidedGame?.name ?? "Soirée jeux"} · {formatDateFr(item.date)}</Link></h2>
      <p className="my-2 text-xs text-muted">Par {item.createdBy.discordName}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{item.chronicle}</p>
    </Card>)}
    <nav aria-label="Pages des chroniques" className="flex justify-between text-sm text-accent">
      {page > 1 ? <Link className="min-h-11 py-3" href={`?page=${page - 1}`}>← Précédente</Link> : <span />}
      {archive.hasNext && <Link className="min-h-11 py-3" href={`?page=${page + 1}`}>Suivante →</Link>}
    </nav>
  </div>;
}
