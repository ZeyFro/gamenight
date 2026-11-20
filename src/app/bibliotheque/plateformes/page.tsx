import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import {
  PLATFORM_FAMILIES,
  crossplayLabel,
  isGamePlatformsEnabled,
  isPlatformFamilyKey,
  listPopularGamesForFamily,
  platformFamily,
  type PlatformFamilyKey,
} from "@/lib/game-platforms";
import { quickAddGameAction } from "./actions";

export const metadata = pageMetadata("Jeux par plateforme");

export default async function PlatformLibraryPage({ searchParams }: { searchParams: Promise<{ plateforme?: string }> }) {
  if (!isGamePlatformsEnabled()) notFound();
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");

  const { plateforme } = await searchParams;
  // Par défaut : la première plateforme que le membre a déclarée, sinon PC.
  const declared = user.availablePlatforms.map(platformFamily).find(isPlatformFamilyKey);
  const family: PlatformFamilyKey = plateforme && isPlatformFamilyKey(plateforme) ? plateforme : declared ?? "PC";
  const games = await listPopularGamesForFamily(user.id, family);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🎮 Ajouter des jeux par plateforme</h1>
        <p className="mt-1 text-sm text-muted">
          Les jeux populaires sur ta plateforme parmi les membres de ton serveur. Un clic l’ajoute à ta bibliothèque.
          Les plateformes sont déclarées par les membres : un jeu sans plateforme connue n’apparaît pas ici.
        </p>
      </div>
      <nav aria-label="Plateforme" className="flex flex-wrap gap-2">
        {PLATFORM_FAMILIES.map((entry) => (
          <Link
            key={entry.key}
            href={`/bibliotheque/plateformes?plateforme=${entry.key}`}
            aria-current={entry.key === family ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm ${entry.key === family ? "bg-accent text-accent-foreground" : "bg-surface-hover text-foreground"}`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {games.length === 0 ? (
        <EmptyState icon="🎮" title="Aucun jeu à proposer sur cette plateforme pour l’instant." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {games.map((game) => (
            <li key={game.id}>
              <Card className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/jeux/${encodeURIComponent(game.id)}`} className="block truncate font-medium text-foreground hover:underline">{game.name}</Link>
                  <p className="text-xs text-muted">
                    {game.owners} membre{game.owners > 1 ? "s" : ""} · {crossplayLabel(game.crossplay)}
                  </p>
                </div>
                <form action={quickAddGameAction}>
                  <input type="hidden" name="gameId" value={game.id} />
                  <input type="hidden" name="family" value={family} />
                  <Button type="submit" variant="secondary" size="sm">Ajouter</Button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
