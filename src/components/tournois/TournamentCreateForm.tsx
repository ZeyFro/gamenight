"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LocalGameOption } from "@/lib/game-search";
import { TournamentGameField, type SelectedGame } from "./TournamentGameField";
import { createTournamentAction } from "@/app/tournois/actions";

/**
 * Formulaire de création de tournoi — extrait de `/tournois/creer/page.tsx`
 * pour que le bouton de soumission puisse rester désactivé tant qu'aucun
 * jeu n'est sélectionné (`TournamentGameField`, ci-dessous) : un état
 * client partagé entre le champ jeu et le bouton, impossible à faire
 * depuis le composant serveur d'origine. `createTournamentAction` (Sprint 5
 * + PR lien Discord) n'est PAS modifiée : elle reçoit toujours un `gameId`
 * dans `formData`, exactement comme avec l'ancien `<select>` — seule la
 * façon de le renseigner change.
 */
export function TournamentCreateForm({ localGames }: { localGames: LocalGameOption[] }) {
  const [selected, setSelected] = useState<SelectedGame | null>(null);

  return (
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
          className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      <TournamentGameField localGames={localGames} selected={selected} onSelectedChange={setSelected} />

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

      <Button type="submit" variant="primary" fullWidthOnMobile disabled={!selected}>
        Créer le tournoi 🏆
      </Button>
    </form>
  );
}
