import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createTournamentAction } from "../actions";

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

  const games = await prisma.game.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🏆 Créer un tournoi</h1>

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</p>
      )}

      {games.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Aucun jeu dans la bibliothèque commune pour l&apos;instant — ajoute d&apos;abord un jeu.
          </p>
        </Card>
      ) : (
        <Card>
          <form action={createTournamentAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="tournament-name">
                Nom du tournoi
              </label>
              <input
                id="tournament-name"
                type="text"
                name="name"
                required
                maxLength={60}
                placeholder="Ex. Le Tournoi du Vendredi"
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="tournament-game">
                Jeu
              </label>
              <select
                id="tournament-game"
                name="gameId"
                required
                defaultValue=""
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
              >
                <option value="" disabled>
                  Choisir un jeu…
                </option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted">Nombre de places</span>
              <div className="grid grid-cols-3 gap-2">
                {[4, 6, 8].map((n) => (
                  <label
                    key={n}
                    className="flex cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-3 py-3 text-sm font-medium text-foreground has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:text-accent"
                  >
                    <input
                      type="radio"
                      name="maxPlayers"
                      value={n}
                      defaultChecked={n === 8}
                      className="sr-only"
                    />
                    {n} joueurs
                  </label>
                ))}
              </div>
            </div>

            <Button type="submit" variant="primary" fullWidthOnMobile>
              Créer le tournoi 🏆
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
