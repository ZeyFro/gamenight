import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getCurrentUser } from "@/lib/current-user";
import { listCommunityGameGraveyard } from "@/lib/community-game-graveyard";
import { isCommunityGameGraveyardEnabled, MAX_GAME_EPITAPH_LENGTH } from "@/lib/community-game-graveyard-input";
import { pageMetadata } from "@/lib/page-title";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { deleteCommunityGameEpitaphAction, saveCommunityGameEpitaphAction } from "./actions";

export const metadata = pageMetadata("Cimetière des jeux");

const MESSAGES: Record<string, string> = {
  saved: "Épitaphe enregistrée.", deleted: "Épitaphe supprimée. Le jeu reste dans les bibliothèques.",
  exists: "Ce jeu a déjà une épitaphe pour ce serveur.",
  invalid: "Choisis un jeu et renseigne une épitaphe de 1 à 1 000 caractères.",
  unavailable: "Le serveur, le jeu ou cette épitaphe n’est plus accessible avec tes droits actuels. Actualise la page.",
  rate: RATE_LIMIT_MESSAGE,
};

export default async function CommunityGameGraveyardPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; result?: string }> }) {
  if (!isCommunityGameGraveyardEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const collection = await listCommunityGameGraveyard(user.id, query);
  const canManage = collection?.role === "ADMIN" || collection?.role === "OWNER";
  const message = MESSAGES[params.result ?? ""];
  return (
    <div className="flex flex-col gap-4">
      <Link href="/profil/lore" className="min-h-11 self-start text-sm text-accent hover:underline">← Retour au Lore du groupe</Link>
      <header>
        <h2 className="text-lg font-semibold text-foreground">Cimetière des jeux</h2>
        {collection && <p className="mt-1 text-sm text-muted">Serveur : {collection.community.name}</p>}
        <p className="mt-2 text-sm text-muted">Un souvenir des jeux que le serveur ne lance plus. Écrire ou retirer une épitaphe ne modifie aucune bibliothèque.</p>
      </header>
      {message && <p role="status" className="text-sm text-foreground">{message}</p>}
      {!collection ? (
        <Card><p className="text-sm text-muted">Choisis une communauté dont tu es membre actif.</p><Link href="/serveurs" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">Choisir un serveur</Link></Card>
      ) : (
        <>
          {canManage && <Card className="flex flex-col gap-3">
            <h3 className="font-semibold">Écrire une épitaphe</h3>
            <form method="get" className="flex flex-col gap-2">
              <label htmlFor="graveyard-search" className="text-sm font-medium">Chercher un jeu du serveur</label>
              <input id="graveyard-search" type="search" name="q" maxLength={100} defaultValue={query} className="rounded-lg border border-border bg-background p-3 text-sm" />
              <Button type="submit" size="sm" className="self-start">Chercher</Button>
            </form>
            {collection.games.length ? (
              <form action={saveCommunityGameEpitaphAction} className="flex flex-col gap-2">
                <input type="hidden" name="communityId" value={collection.community.id} />
                <label htmlFor="graveyard-game" className="text-sm font-medium">Jeu possédé ou déjà joué par le serveur</label>
                <select id="graveyard-game" name="gameId" required defaultValue="" className="rounded-lg border border-border bg-background p-3 text-sm">
                  <option value="">Choisir un jeu</option>
                  {collection.games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
                </select>
                {collection.hasMoreGames && <p className="text-xs text-muted">Les 100 premiers résultats sont affichés. Affine la recherche pour trouver un autre jeu.</p>}
                <label htmlFor="new-epitaph" className="text-sm font-medium">Épitaphe (1 000 caractères maximum)</label>
                <textarea id="new-epitaph" name="epitaph" required maxLength={MAX_GAME_EPITAPH_LENGTH} rows={3} className="rounded-lg border border-border bg-background p-3 text-sm" />
                <Button type="submit" size="sm" className="self-start">Ajouter au cimetière</Button>
              </form>
            ) : <p className="text-sm text-muted">Aucun jeu sans épitaphe ne correspond à cette recherche dans ce serveur.</p>}
          </Card>}
          {collection.entries.length === 0 && <p className="text-sm text-muted">Aucune épitaphe pour ce serveur.</p>}
          <ul className="flex flex-col gap-3">
            {collection.entries.map(entry => {
              return (
                <li key={entry.id}>
                  <Card className="flex flex-col gap-3">
                    <h3 className="font-semibold"><Link href={`/jeux/${entry.game.id}`} className="text-accent hover:underline">{entry.game.name}</Link></h3>
                    <p className="whitespace-pre-wrap break-words text-sm text-muted">{entry.epitaph}</p>
                    {canManage && (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-accent">Modifier ou retirer l’épitaphe</summary>
                        <form action={saveCommunityGameEpitaphAction} className="flex flex-col gap-2">
                          <input type="hidden" name="communityId" value={collection.community.id} /><input type="hidden" name="id" value={entry.id} /><input type="hidden" name="gameId" value={entry.game.id} />
                          <label htmlFor={`${entry.id}-epitaph`} className="text-sm font-medium">Épitaphe (1 000 caractères maximum)</label>
                          <textarea id={`${entry.id}-epitaph`} name="epitaph" required maxLength={MAX_GAME_EPITAPH_LENGTH} rows={3} defaultValue={entry.epitaph} className="rounded-lg border border-border bg-background p-3 text-sm" />
                          <Button type="submit" size="sm" className="self-start">Enregistrer</Button>
                        </form>
                        <form action={deleteCommunityGameEpitaphAction} className="mt-3">
                          <input type="hidden" name="communityId" value={collection.community.id} /><input type="hidden" name="id" value={entry.id} />
                          <Button type="submit" variant="destructive" size="sm">Retirer l’épitaphe</Button>
                        </form>
                      </details>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
