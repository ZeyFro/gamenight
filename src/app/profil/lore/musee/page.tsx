import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { listCommunityHighlights } from "@/lib/community-highlights";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { pageMetadata } from "@/lib/page-title";
import { saveHighlightAction, deleteHighlightAction } from "./actions";

export const metadata = pageMetadata("Exploits et fails");

function Fields({ item }: { item?: { kind: string; title: string; description: string; mediaUrl: string | null } }) {
  const fieldClass = "min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground";
  return <>
    <label className="flex flex-col gap-1 text-sm">Catégorie<select name="kind" className={fieldClass} defaultValue={item?.kind ?? "FAME"}>
      <option value="FAME">Exploit — Hall of Fame</option><option value="SHAME">Fail — Hall of Shame</option>
    </select></label>
    <label className="flex flex-col gap-1 text-sm">Titre<input name="title" required maxLength={120} className={fieldClass} defaultValue={item?.title} /></label>
    <label className="flex flex-col gap-1 text-sm">Le souvenir<textarea name="description" required maxLength={4000} rows={3} className={fieldClass} defaultValue={item?.description} /></label>
    <label className="flex flex-col gap-1 text-sm">Lien vers une image ou un clip (facultatif)<input type="url" name="mediaUrl" maxLength={2048} className={fieldClass} defaultValue={item?.mediaUrl ?? ""} placeholder="https://…" /></label>
  </>;
}

export default async function CommunityMuseumPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const query = await searchParams;
  const page = query.page === undefined ? 1 : typeof query.page === "string" && /^\d+$/.test(query.page) ? Number(query.page) : NaN;
  const result = await listCommunityHighlights(user.id, page);
  if (!result) notFound();
  return <div className="flex flex-col gap-5">
    <Link href="/profil/lore" className="text-sm text-accent">← Lore du groupe</Link>
    <header><h1 className="text-xl font-semibold">Exploits et fails · {result.communityName}</h1>
      <p className="mt-2 text-sm text-muted">Les grands moments et les ratés du serveur, racontés avec bienveillance. Les médias restent des liens : aucun fichier n’est envoyé ici.</p></header>
    {query.saved && <p role="status" className="text-sm text-accent">Souvenir enregistré.</p>}
    {query.error && <p role="alert" className="text-sm text-destructive">{query.error === "rate" ? "Doucement, réessaie dans un instant." : "Souvenir refusé : vérifie les champs et ton accès au serveur."}</p>}
    {result.canModerate && <Card><h2 className="mb-3 font-semibold">Ajouter un souvenir</h2><form action={saveHighlightAction} className="flex flex-col gap-3">
      <input type="hidden" name="communityId" value={result.communityId} /><input type="hidden" name="creationKey" value={randomUUID()} /><Fields /><Button type="submit">Publier</Button>
    </form></Card>}
    {result.items.length === 0 && <p className="text-sm text-muted">Aucun souvenir sur cette page. À vous d’écrire le premier !</p>}
    {result.items.map(item => <Card key={item.id} className="flex flex-col gap-3">
      <h2 className="font-semibold">{item.kind === "FAME" ? "🏆" : "🙈"} {item.title}</h2>
      <p className="whitespace-pre-wrap text-sm text-muted">{item.description}</p>
      <p className="text-xs text-faint">Raconté par {item.createdBy.discordName}</p>
      {item.mediaUrl && <a href={item.mediaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-accent">Voir l’image ou le clip ↗</a>}
      {result.canModerate && <details><summary className="cursor-pointer py-3 text-sm">Modifier ou supprimer</summary>
        <form action={saveHighlightAction} className="flex flex-col gap-3"><input type="hidden" name="communityId" value={result.communityId} /><input type="hidden" name="id" value={item.id} /><Fields item={item} /><Button type="submit" size="sm">Enregistrer</Button></form>
        <form action={deleteHighlightAction} className="mt-3"><input type="hidden" name="communityId" value={result.communityId} /><input type="hidden" name="id" value={item.id} /><Button type="submit" size="sm" variant="destructive">Supprimer ce souvenir</Button></form>
      </details>}
    </Card>)}
    <nav aria-label="Pages des souvenirs" className="flex justify-between text-sm text-accent">
      {page > 1 ? <Link className="py-3" href={`?page=${page - 1}`}>← Précédente</Link> : <span />}
      {result.hasNext && <Link className="py-3" href={`?page=${page + 1}`}>Suivante →</Link>}
    </nav>
  </div>;
}
