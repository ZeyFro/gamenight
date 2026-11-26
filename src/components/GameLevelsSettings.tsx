import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { listGameLevelChoices, listOwnGameLevels } from "@/lib/game-levels";
import { GAME_LEVELS, GAME_LEVEL_LABELS, isGameLevelsEnabled, MAX_GAME_LEVELS_PER_USER } from "@/lib/game-levels-rules";
import { removeGameLevelAction, setGameLevelAction } from "@/app/profil/game-level-actions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

const FEEDBACK: Record<string, string> = {
  saved: "Niveau de jeu enregistré.", removed: "Niveau de jeu retiré.", invalide: "Choisis un jeu et un niveau de jeu valides.",
  invalid_game: "Ce jeu n’existe pas.", limit: `Tu peux déclarer jusqu’à ${MAX_GAME_LEVELS_PER_USER} jeux.`,
  indisponible: "Cette fonction n’est pas activée.", rate_limited: RATE_LIMIT_MESSAGE,
};

/** Section « Mes niveaux de jeu » de /profil/parametres. Rien n'est rendu (ni lu) flag éteint. */
export async function GameLevelsSettings({ userId, feedback }: { userId: string; feedback?: string }) {
  if (!isGameLevelsEnabled()) return null;
  const [levels, choices] = await Promise.all([listOwnGameLevels(userId), listGameLevelChoices(userId)]);
  return <Card className="flex flex-col gap-4">
    <h2 className="font-semibold">Mes niveaux de jeu</h2>
    <p className="text-sm text-muted">Niveau de jeu auto-déclaré, facultatif, visible par les membres autorisés à consulter ta fiche. Si tu masques ton profil, tes niveaux de jeu ne sont pas visibles non plus.</p>
    {feedback && FEEDBACK[feedback] && <p role={feedback === "saved" || feedback === "removed" ? "status" : "alert"} className="text-sm">{FEEDBACK[feedback]}</p>}
    {levels.length > 0 && <ul className="grid gap-2">
      {levels.map((entry) => <li key={entry.gameId} className="flex items-center justify-between gap-3 text-sm">
        <span>{entry.gameName} · <strong>{GAME_LEVEL_LABELS[entry.level]}</strong></span>
        <form action={removeGameLevelAction}><input type="hidden" name="gameId" value={entry.gameId} /><Button type="submit" size="sm">Retirer</Button></form>
      </li>)}
    </ul>}
    <form action={setGameLevelAction} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <label className="grid gap-1 text-sm">Jeu
        <select name="gameId" required defaultValue="" className="rounded-lg border border-border bg-background px-3 py-3 text-base">
          <option value="" disabled>Choisir un jeu de ma bibliothèque</option>
          {choices.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Niveau de jeu
        <select name="level" required defaultValue="INTERMEDIAIRE" className="rounded-lg border border-border bg-background px-3 py-3 text-base">
          {GAME_LEVELS.map((level) => <option key={level} value={level}>{GAME_LEVEL_LABELS[level]}</option>)}
        </select>
      </label>
      <Button type="submit" variant="primary" className="self-end">Enregistrer</Button>
    </form>
  </Card>;
}
