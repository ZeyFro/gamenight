"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { submitSessionResultsAction } from "@/app/sessions/actions";

export interface ResultParticipant {
  id: string;
  discordName: string;
  discordAvatar: string | null;
}

const PLACEMENT_LABELS: Record<number, string> = {
  1: "🥇 1er",
  2: "🥈 2e",
  3: "🥉 3e",
};

/**
 * Saisie du podium (ou de la simple confirmation coop) après une soirée
 * `DONE`. Conçu pour être étendu en PR 5/9 : les champs de stats
 * spécifiques au jeu (superlatifs) s'ajouteront par participant, sur ce
 * même formulaire, une fois `/admin/jeux-stats` en place.
 *
 * Le podium est géré en state React plutôt qu'avec des `<input
 * type="radio">` nommés par placement : un participant peut occuper au
 * plus un placement, et choisir un placement déjà pris par quelqu'un
 * d'autre le lui retire automatiquement — plus simple à obtenir avec un
 * petit state partagé qu'avec des groupes de radios exclusifs par
 * placement (qui empêcheraient nativement "un seul 1er" mais pas "chaque
 * participant a au plus un placement").
 */
export function SessionResultsForm({
  sessionId,
  participants,
  isCoop,
}: {
  sessionId: string;
  participants: ResultParticipant[];
  isCoop: boolean;
}) {
  const [placements, setPlacements] = useState<Record<string, number | null>>({});

  function togglePlacement(participantId: string, value: number) {
    setPlacements((prev) => {
      const next: Record<string, number | null> = { ...prev };
      const alreadySelected = next[participantId] === value;

      for (const id of Object.keys(next)) {
        if (next[id] === value) next[id] = null;
      }
      next[participantId] = alreadySelected ? null : value;
      return next;
    });
  }

  if (isCoop) {
    return (
      <form action={submitSessionResultsAction} className="flex flex-col gap-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <p className="text-sm text-muted">
          Jeu coop : pas de podium, tout le monde reçoit le même bonus.
        </p>
        <ul className="flex flex-col gap-2">
          {participants.map((p) => (
            <li
              key={p.id}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
            >
              <Avatar src={p.discordAvatar} alt={p.discordName} size={32} />
              <span className="text-sm text-foreground">{p.discordName}</span>
            </li>
          ))}
        </ul>
        <Button type="submit" variant="primary" fullWidthOnMobile>
          Confirmer la participation ({participants.length})
        </Button>
      </form>
    );
  }

  return (
    <form action={submitSessionResultsAction} className="flex flex-col gap-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <p className="text-sm text-muted">
        Podium facultatif — laisse un participant sans place si le
        classement n&apos;a pas d&apos;importance pour lui.
      </p>

      <div className="flex flex-col gap-2">
        {participants.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
          >
            <input
              type="hidden"
              name={`placement-${p.id}`}
              value={placements[p.id] ?? ""}
            />
            <Avatar src={p.discordAvatar} alt={p.discordName} size={32} />
            <span className="min-w-0 flex-1 text-sm text-foreground">
              {p.discordName}
            </span>
            <div className="flex gap-1.5">
              {[1, 2, 3].map((place) => (
                <button
                  key={place}
                  type="button"
                  onClick={() => togglePlacement(p.id, place)}
                  className={`min-h-11 rounded-lg px-3 text-sm font-medium transition-colors ${
                    placements[p.id] === place
                      ? "bg-accent text-accent-foreground"
                      : "border border-border text-muted hover:border-border-hover hover:text-foreground"
                  }`}
                >
                  {PLACEMENT_LABELS[place]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Button type="submit" variant="primary" fullWidthOnMobile>
        Enregistrer les résultats
      </Button>
    </form>
  );
}
