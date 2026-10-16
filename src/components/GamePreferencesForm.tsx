import Link from "next/link";
import { GAME_CATEGORIES, type GameTaste } from "@/lib/game-preferences";
import { updateGamePreferencesAction, setGameRefusalAction } from "@/app/profil/game-preference-actions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { RefuseGameForm } from "@/components/RefuseGameForm";
import { Card } from "@/components/ui/Card";

const FEEDBACK: Record<string, string> = {
  ok: "Tes préférences ont été enregistrées.",
  invalide: "Choisis les catégories proposées, sans préférer et refuser la même catégorie.",
  inaccessible: "Ce jeu n’est plus accessible dans la bibliothèque du serveur affiché.",
  rate_limited: RATE_LIMIT_MESSAGE,
};
export function GamePreferencesForm({ user, games, refusals, feedback }: {
  user: GameTaste; games: Array<{ id: string; name: string }>;
  refusals: Array<{ gameId: string; game: { name: string } }>; feedback?: string;
}) {
  return <Card className="flex flex-col gap-4">
    <h2 className="font-semibold">Mes préférences et refus de jeux</h2>
    <p className="text-sm text-muted">Ces choix personnels servent aux suggestions lorsque tu fais partie des participants choisis. Les suggestions n’affichent pas les refus individuels et ne changent pas les votes ou tirages existants.</p>
    {feedback && FEEDBACK[feedback] && <p role={feedback === "ok" ? "status" : "alert"}>{FEEDBACK[feedback]}</p>}
    <form action={updateGamePreferencesAction} className="flex flex-col gap-4">
      {([
        { key: "preferredGameCategories", label: "Ce que je préfère" },
        { key: "refusedGameCategories", label: "Ce que je refuse" },
      ] as const).map(field => <fieldset key={field.key} className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">{field.label}</legend>
        {GAME_CATEGORIES.map(category => <label key={category.key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name={field.key} value={category.key} defaultChecked={user[field.key].includes(category.key)} />{category.label}
        </label>)}
      </fieldset>)}
      <p className="text-xs text-muted">Décoche toutes les catégories pour effacer ces choix. Un refus prime toujours sur les préférences des autres participants.</p>
      <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">Enregistrer mes préférences</button>
    </form>
    <h3 className="text-sm font-semibold">Jeux que je refuse</h3>
    <RefuseGameForm games={games} />
    <ul className="flex flex-col gap-2">
      {refusals.map(refusal => <li key={refusal.gameId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{refusal.game.name}</span>
        <form action={setGameRefusalAction}>
          <input type="hidden" name="gameId" value={refusal.gameId} /><input type="hidden" name="mode" value="remove" />
          <button className="text-accent underline" aria-label={`Retirer le refus de ${refusal.game.name}`}>Retirer le refus</button>
        </form>
      </li>)}
    </ul>
    <Link href="/bibliotheque/suggestions" className="text-sm text-accent underline">Trouver des jeux selon les préférences</Link>
  </Card>;
}
