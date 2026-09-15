import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { Card } from "@/components/ui/Card";
import { TournamentCreateForm } from "@/components/tournois/TournamentCreateForm";

const TOURNAMENT_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
};

/** Sprint 5 (FEATURE 1, Tournois Bracket) — formulaire de création : nom, jeu (biblio commune), nombre de places (4/6/8). */
export default async function CreerTournoiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { error } = await searchParams;
  const errorMessage = error ? (TOURNAMENT_ERROR_MESSAGES[error] ?? null) : null;

  // igdbId inclus (en plus de id/name) : nécessaire à `TournamentGameField`
  // pour ne pas afficher deux fois le même jeu (biblio locale + résultat
  // IGDB) quand ils partagent le même identifiant externe.
  const games = await prisma.game.findMany({
    select: { id: true, name: true, igdbId: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🏆 Créer un tournoi</h1>

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</p>
      )}

      <Card>
        <TournamentCreateForm localGames={games} />
      </Card>
    </div>
  );
}
