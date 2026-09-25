"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LocalGameOption } from "@/lib/game-search";
import { TournamentGameField, type SelectedGame } from "@/components/tournois/TournamentGameField";
import {
  changeInstantSessionGameAction,
  INITIAL_INSTANT_SESSION_ACTION_STATE,
} from "@/app/jouer-maintenant/actions";

/**
 * "Changement de jeu réservé au créateur" — le bouton n'est rendu que
 * côté créateur (page appelante, `InstantSessionDetail`), la garde
 * serveur (`changeInstantSessionGame` refuse tout autre appelant) reste
 * la vraie protection. Réutilise `TournamentGameField` tel quel.
 */
export function ChangeInstantSessionGameControl({
  instantSessionId,
  localGames,
}: {
  instantSessionId: string;
  localGames: LocalGameOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<SelectedGame | null>(null);
  const [state, formAction, pending] = useActionState(
    changeInstantSessionGameAction,
    INITIAL_INSTANT_SESSION_ACTION_STATE
  );

  if (!editing) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
        Changer de jeu
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      onSubmit={() => {
        // Referme le champ après soumission — `useActionState` garde la
        // page en place (jamais de navigation), le poll suivant reflète
        // le nouveau jeu.
        setTimeout(() => setEditing(false), 0);
      }}
    >
      <input type="hidden" name="instantSessionId" value={instantSessionId} />
      <TournamentGameField localGames={localGames} selected={selected} onSelectedChange={setSelected} />
      {state.status === "error" && (
        <p className="text-sm text-destructive">Impossible de changer de jeu pour le moment.</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!selected || pending}>
          {pending ? "…" : "Valider"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
