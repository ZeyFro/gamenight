import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { LibraryTabs } from "@/components/LibraryTabs";
import { ToVerifierList } from "@/components/ToVerifierList";

export default async function AVerifierPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const userGames = await prisma.userGame.findMany({
    where: {
      userId: user.id,
      owned: true,
      game: { isCoop: false, playInfoManual: false },
    },
    include: { game: true },
    orderBy: { game: { name: "asc" } },
  });

  const games = userGames.map(({ game }) => ({
    id: game.id,
    name: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
  }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
        Ma bibliothèque
      </h1>

      {/* Pas de `toVerifyCount` ici : la liste ci-dessous affiche déjà son
          propre compteur, toujours à jour côté client au fil du
          traitement — contrairement au badge de `LibraryTabs`, calculé
          une fois côté serveur au chargement de la page. */}
      <LibraryTabs active="a-verifier" />

      <p className="text-sm text-muted">
        Ces jeux n&apos;ont pas encore de mode de jeu confirmé (ni par le
        backfill Steam/IGDB, ni manuellement). Vérifie-les rapidement
        ci-dessous.
      </p>

      <ToVerifierList games={games} />
    </div>
  );
}
