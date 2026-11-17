import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { pageMetadata } from "@/lib/page-title";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { searchTowerForums, TOWER_FORUM_QUERY_MAX } from "@/lib/tower-forums";

export const metadata = pageMetadata("Forums The Tower");

const STATUS_LABELS = {
  invalid: "Saisis le nom d’un jeu pour lancer la recherche.",
  forbidden: "Sélectionne la communauté The Tower pour consulter les forums auxquels tu as accès.",
  unavailable: "La recherche Discord est momentanément indisponible.",
  rate_limited: RATE_LIMIT_MESSAGE,
};

export default async function TowerForumsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const { q } = await searchParams;
  const game = typeof q === "string" && q.length <= TOWER_FORUM_QUERY_MAX ? q.trim() : "";
  const result = game ? await searchTowerForums({ id: user.id, discordId: user.discordId }, game) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Forums The Tower</h1>
        <p className="text-sm text-muted">Recherche dans les titres et les tags des fils actifs et des archives récentes.</p>
        <Link className="text-sm text-accent underline" href="/joueurs">Voir les annonces GameNight</Link>
      </div>
      <form action="/tower/forums" method="get" role="search" className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Nom du jeu</span>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            type="search" name="q" defaultValue={game} maxLength={TOWER_FORUM_QUERY_MAX} required
          />
        </label>
        <Button type="submit" variant="primary">Rechercher</Button>
      </form>
      {result && (result.status === "ready" ? (
        result.forums.length ? result.forums.map((forum) => (
          <Card key={forum.id} className="flex flex-col gap-2">
            <h2 className="font-semibold">{forum.label}</h2>
            <p className="text-xs text-muted">Tags suggérés — {forum.suggestedTags.join(", ")}</p>
            {forum.posts.length ? (
              <ul className="flex flex-col gap-2">
                {forum.posts.map((post) => (
                  <li key={post.url} className="min-w-0 break-words">
                    <a className="text-accent underline" href={post.url}>{post.title}</a>
                    {post.tags.length > 0 && <p className="text-xs text-muted">{post.tags.join(", ")}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Aucune publication trouvée pour ce jeu.</p>}
          </Card>
        )) : <p role="status" className="text-sm text-muted">Aucun forum accessible à ton compte.</p>
      ) : <p role="status" className="text-sm text-muted">{STATUS_LABELS[result.status]}</p>)}
    </main>
  );
}
