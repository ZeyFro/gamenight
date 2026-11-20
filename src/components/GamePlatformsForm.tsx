import { PLAYER_PLATFORMS } from "@/lib/player-equipment";
import { crossplayLabel } from "@/lib/game-platforms";
import { updateGamePlatformsAction } from "@/app/jeux/platforms-actions";

/** Fiche jeu : plateformes et crossplay. Lecture pour tous, modification pour qui possède le jeu. */
export function GamePlatformsForm({ game, canEdit }: { game: { id: string; platforms: string[]; crossplay: boolean | null }; canEdit: boolean }) {
  const labels = PLAYER_PLATFORMS.filter((option) => game.platforms.includes(option.key)).map((option) => option.label);
  return (
    <section className="rounded-lg border border-border p-3" aria-label="Plateformes et crossplay">
      <p className="font-medium">Plateformes : {labels.length ? labels.join(", ") : "non renseignées"}</p>
      <p className="text-sm text-muted">{crossplayLabel(game.crossplay)}</p>
      {canEdit && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium">Renseigner les plateformes</summary>
          <form action={updateGamePlatformsAction} className="mt-2 grid gap-3">
            <input type="hidden" name="gameId" value={game.id} />
            <div className="flex flex-wrap gap-3">
              {PLAYER_PLATFORMS.map((option) => (
                <label key={option.key} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="platforms" value={option.key} defaultChecked={game.platforms.includes(option.key)} />
                  {option.label}
                </label>
              ))}
            </div>
            <label className="grid gap-1 text-sm">
              Crossplay entre plateformes
              <select name="crossplay" defaultValue={game.crossplay === null ? "" : game.crossplay ? "yes" : "no"} className="rounded-lg border border-border bg-background p-2">
                <option value="">Inconnu</option>
                <option value="yes">Oui</option>
                <option value="no">Non</option>
              </select>
            </label>
            <button type="submit" className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground">Enregistrer</button>
          </form>
        </details>
      )}
    </section>
  );
}
