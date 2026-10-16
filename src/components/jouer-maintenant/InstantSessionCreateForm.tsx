"use client";

import { CreationForm } from "@/components/CreationForm";
import { GameWarnings } from "@/components/GameWarnings";
import type { GameWarningsData } from "@/lib/game-warnings";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LocalGameOption } from "@/lib/game-search";
import { NotifyRecipientsField, type NotifyRecipientCandidate } from "@/components/NotifyRecipientsField";
import { TournamentGameField, type SelectedGame } from "@/components/tournois/TournamentGameField";
import { createInstantSessionAction } from "@/app/jouer-maintenant/actions";

/**
 * Formulaire de création — "Jouer maintenant" (V2). Réutilise TEL QUEL
 * `TournamentGameField` (sélecteur biblio locale + IGDB, déjà générique,
 * rien de spécifique aux tournois dedans) et `NotifyRecipientsField`
 * (déjà utilisé par soirées/roulettes/tournois pour "qui prévenir").
 * Aucun champ "nom" : contrairement à un tournoi, une session instantanée
 * n'a pas d'identité propre au-delà du jeu choisi — le formulaire de
 * `TournamentCreateForm` sert de modèle pour le reste (bouton désactivé
 * tant qu'aucun jeu n'est sélectionné, état client partagé).
 */
export function InstantSessionCreateForm({
  localGames,
  potes,
}: {
  localGames: Array<LocalGameOption & GameWarningsData>;
  potes: NotifyRecipientCandidate[];
}) {
  const [selected, setSelected] = useState<SelectedGame | null>(null);

  return (
    <CreationForm action={createInstantSessionAction} className="flex flex-col gap-4">
      <TournamentGameField localGames={localGames} selected={selected} onSelectedChange={setSelected} />
      {selected && <GameWarnings game={localGames.find(game => game.id === selected.id) ?? {}} />}

      {potes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
          <NotifyRecipientsField potes={potes} label="Prévenir qui ?" />
          <p className="text-xs text-faint">
            Les potes cochés reçoivent un MP Discord + une notification (selon leurs préférences) —
            ils ne sont ni inscrits automatiquement, ni seuls autorisés à voir ou rejoindre la
            session : n&apos;importe qui peut la rejoindre librement tant qu&apos;elle est active.
          </p>
        </div>
      )}

      <Button type="submit" variant="primary" fullWidthOnMobile disabled={!selected}>
        Démarrer 🎮
      </Button>
    </CreationForm>
  );
}
