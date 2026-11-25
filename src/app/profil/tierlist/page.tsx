import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { TierlistBoard } from "@/components/TierlistBoard";
import { pageMetadata } from "@/lib/page-title";
import { dedupeTierlistGames } from "@/lib/tierlist";

export const metadata = pageMetadata("Ma tier list");

/**
 * Onglet "Tierlist" — voir `../layout.tsx` pour l'en-tête. Fix UX (après
 * test prod de la PR 8/9) : l'onglet pointait vers `/tierlist` (page
 * top-level, sous les onglets `LibraryTabs`), ce qui faisait sortir du
 * profil au clic — pas l'expérience attendue pour un onglet de profil.
 * Affiche maintenant la tierlist inline, ici, en réutilisant tel quel
 * `TierlistBoard` (même logique, mêmes données) — `/tierlist` reste
 * fonctionnelle en parallèle (non-régression, toujours accessible depuis
 * `LibraryTabs`), les deux pointent vers le même composant/la même
 * action serveur, pas de logique dupliquée à maintenir.
 */
export default async function ProfilTierlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [games, entries] = await Promise.all([
    prisma.game.findMany({
      where: { userGames: { some: { owned: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.tierlistEntry.findMany({ where: { userId: user.id } }),
  ]);

  // Même jeu importé en Steam et en IGDB : une seule carte, rang conservé.
  const { games: uniqueGames, initialTiers } = dedupeTierlistGames(games, entries);

  if (uniqueGames.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aucun jeu dans la bibliothèque commune pour l&apos;instant.
      </p>
    );
  }

  return (
    <TierlistBoard
      games={uniqueGames.map((g) => ({ id: g.id, name: g.name, coverUrl: g.coverUrl }))}
      initialTiers={initialTiers}
    />
  );
}
