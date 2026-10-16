import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { loadGameSuggestions } from "@/lib/game-suggestions";
import { pageMetadata } from "@/lib/page-title";
import { LibraryTabs } from "@/components/LibraryTabs";

export const metadata = pageMetadata("Suggestions de jeux");
export default async function GameSuggestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const params = await searchParams;
  const selected = typeof params.participants === "string" ? [params.participants] : params.participants ?? (params.selection === undefined ? [user.id] : []);
  const result = await loadGameSuggestions(user.id, selected);
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
    <h1 className="text-2xl font-semibold">Suggestions de jeux</h1>
    <LibraryTabs active="suggestions" />
    <p className="text-sm text-muted">Des jeux déclarés possédés par toutes les personnes cochées, sans leurs jeux ou catégories refusés. Les préférences départagent les résultats ; les capacités connues doivent convenir au groupe.</p>
    <form method="get" action="/bibliotheque/suggestions" className="rounded-xl border border-border bg-surface p-4">
      <input type="hidden" name="selection" value="1" />
      <fieldset><legend className="font-medium">Participants, toi compris si tu joues (100 maximum)</legend>
        <div className="my-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
          {result.members.map(member => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="participants" value={member.id} defaultChecked={selected.includes(member.id)} />{member.discordName}</label>)}
        </div>
      </fieldset>
      <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">Chercher des jeux</button>
    </form>
    <Link href="/profil/parametres" className="text-sm text-accent underline">Renseigner mes préférences et refus</Link>
    {result.error && <p role="alert">La sélection est invalide ou contient une personne devenue inaccessible. Aucune suggestion n’est calculée sur une sélection réduite.</p>}
    {!selected.length && <p>Choisis au moins un participant.</p>}
    {result.unknownMetadataCount > 0 && <p role="status" className="text-sm text-muted">Certaines fiches n’ont pas assez de données pour vérifier les refus et restent hors des suggestions. Leurs détails peuvent être actualisés depuis la fiche du jeu.</p>}
    {!result.error && selected.length > 0 && !result.suggestions.length && <p>Aucun jeu commun ne respecte les refus et les capacités connues. Aucun refus n’a été assoupli pour produire un résultat.</p>}
    {result.totalSuggestions > 24 && <p className="text-sm text-muted">Les 24 premiers jeux sur {result.totalSuggestions} sont affichés.</p>}
    <ul className="grid gap-3 sm:grid-cols-2">
      {result.suggestions.map(game => <li key={game.id} className="rounded-xl border border-border bg-surface p-4">
        <Link href={`/jeux/${encodeURIComponent(game.id)}`} className="font-semibold text-accent underline">{game.name}</Link>
        <p className="mt-1 text-sm text-muted">Correspond aux préférences de {game.preferredByCount} participant{game.preferredByCount === 1 ? "" : "s"}.</p>
        {!game.capacityKnown && <p className="text-xs text-muted">Capacité en joueurs à vérifier sur la fiche.</p>}
      </li>)}
    </ul>
  </div>;
}
