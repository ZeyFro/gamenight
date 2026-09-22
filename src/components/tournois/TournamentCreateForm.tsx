"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LocalGameOption } from "@/lib/game-search";
import { NotifyRecipientsField, type NotifyRecipientCandidate } from "@/components/NotifyRecipientsField";
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
 *
 * V2 (notifications maîtrisées) — `NotifyRecipientsField` (déjà utilisé
 * pour les soirées/roulettes) réutilisé tel quel pour choisir qui
 * mentionner Discord à l'ouverture des inscriptions : ces potes ne sont NI
 * inscrits automatiquement NI seuls autorisés à voir/rejoindre le tournoi
 * (contrairement aux soirées, un tournoi reste ouvert à tous selon les
 * règles d'accès actuelles) — uniquement une liste de personnes à
 * prévenir. Aucune pré-sélection par défaut n'est modifiée par ce champ :
 * `NotifyRecipientsField` coche déjà tout le monde par défaut, décocher
 * reste l'action volontaire.
 */
export function TournamentCreateForm({
  localGames,
  potes,
}: {
  localGames: LocalGameOption[];
  potes: NotifyRecipientCandidate[];
}) {
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

      {potes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
          <NotifyRecipientsField potes={potes} label="Qui prévenir de l'ouverture des inscriptions ?" />
          <p className="text-xs text-faint">
            Les potes cochés reçoivent une mention Discord dans l&apos;annonce du tournoi (si le
            bot Discord est configuré) — ils ne sont ni inscrits automatiquement, ni seuls
            autorisés à voir ou rejoindre le tournoi : n&apos;importe qui peut consulter et
            s&apos;inscrire tant que les places sont ouvertes.
          </p>
        </div>
      )}

      <Button type="submit" variant="primary" fullWidthOnMobile disabled={!selected}>
        Créer le tournoi 🏆
      </Button>
    </form>
  );
}
