import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { getTournamentTeamsCommunityId } from "@/lib/tournament-teams";
import { listTeamTournaments, listTournamentGames } from "@/lib/tournament-teams-read";
import { MAX_TOURNAMENT_TEAMS, MIN_TOURNAMENT_TEAMS } from "@/lib/tournament-teams-rules";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { pageMetadata } from "@/lib/page-title";
import { TOURNAMENT_QUOTA_ERROR_KEY, TOURNAMENT_QUOTA_MESSAGE } from "@/lib/creation-quota";
import { createTeamTournamentAction } from "./actions";

export const metadata = pageMetadata("Tournois d’équipes");

const RESULT_MESSAGES: Record<string, string> = {
  invalid: "Informations invalides.", rate: "Trop de demandes, réessaie dans une minute.", invalid_game: "Jeu introuvable.",
  unavailable: "Les tournois d’équipes ne sont pas disponibles dans ta communauté.", created: "Tournoi créé.",
  [TOURNAMENT_QUOTA_ERROR_KEY]: TOURNAMENT_QUOTA_MESSAGE,
};

const STATUS_LABELS = { REGISTRATION: "Inscriptions ouvertes", IN_PROGRESS: "En cours", DONE: "Terminé" } as const;
const inputClass = "rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground";

export default async function TeamTournamentsPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getTournamentTeamsCommunityId(user.id);
  if (!communityId) {
    return <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8"><h1 className="text-2xl font-semibold">🏆 Tournois d’équipes</h1><Card className="text-sm text-muted">Les tournois d’équipes ne sont pas disponibles dans ta communauté.</Card><Link className="text-sm text-accent" href="/tournois">← Tournois</Link></main>;
  }
  const [{ result }, tournaments, games] = await Promise.all([searchParams, listTeamTournaments(user.id, communityId), listTournamentGames()]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <Link href="/tournois" className="text-sm text-accent underline-offset-4 hover:underline">← Tournois</Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">🏆 Tournois d’équipes</h1>
        <p className="mt-2 text-sm text-muted">Les équipes s’inscrivent par leur capitaine, un tournoi par jeu. Chaque résultat est confirmé par les deux capitaines ; en cas de désaccord, l’organisateur tranche.</p>
      </header>
      {result && RESULT_MESSAGES[result] && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULT_MESSAGES[result]}</p>}

      <Card>
        <form action={createTeamTournamentAction} className="flex flex-col gap-3">
          <h2 className="font-semibold text-foreground">Organiser un tournoi d’équipes</h2>
          <label htmlFor="tt-name" className="text-sm font-medium">Nom</label>
          <input id="tt-name" name="name" required minLength={3} maxLength={80} className={inputClass} />
          <label htmlFor="tt-game" className="text-sm font-medium">Jeu</label>
          <select id="tt-game" name="gameId" required className={inputClass}>
            <option value="">Choisir un jeu</option>
            {games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
          </select>
          <label htmlFor="tt-max" className="text-sm font-medium">Nombre maximal d’équipes ({MIN_TOURNAMENT_TEAMS} à {MAX_TOURNAMENT_TEAMS})</label>
          <input id="tt-max" name="maxTeams" type="number" required min={MIN_TOURNAMENT_TEAMS} max={MAX_TOURNAMENT_TEAMS} defaultValue={4} className={inputClass} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPrivate" /> Privé : sur invitation de l’organisateur seulement</label>
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Fin des inscriptions (facultatif, heure de Paris)</legend>
            <input name="closesDate" type="date" aria-label="Date de fin des inscriptions" className={inputClass} />
            <input name="closesTime" type="time" step={60} aria-label="Heure de fin des inscriptions" className={inputClass} />
            <p className="text-xs text-muted">À l’échéance, le tournoi est lancé avec les équipes inscrites (au moins 2) ; les inscriptions sont alors verrouillées.</p>
          </fieldset>
          <Button type="submit" variant="primary">Créer</Button>
        </form>
      </Card>

      <section aria-labelledby="tt-list" className="grid gap-3">
        <h2 id="tt-list" className="font-semibold text-foreground">Tournois ({tournaments.length})</h2>
        {tournaments.length === 0 ? <EmptyState icon="🏆" title="Aucun tournoi d’équipes pour le moment." /> : tournaments.map(tournament => (
          <Link key={tournament.id} href={`/tournois/equipes/${tournament.id}`}>
            <Card className="grid gap-1">
              <p className="font-semibold text-foreground">{tournament.name}{tournament.teamSettings?.isPrivate ? " 🔒" : ""}</p>
              <p className="text-sm text-muted">{tournament.game.name} · {STATUS_LABELS[tournament.status as keyof typeof STATUS_LABELS]} · {tournament._count.teamEntries}/{tournament.teamSettings?.maxTeams} équipes</p>
            </Card>
          </Link>
        ))}
      </section>
    </main>
  );
}
