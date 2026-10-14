"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { submitSuperlativeVotesAction } from "@/app/sessions/actions/superlatives";

export interface VoteParticipant {
  id: string;
  discordName: string;
  discordAvatar: string | null;
}

export interface VoteCategory {
  id: string;
  icon: string;
  name: string;
  description: string | null;
}

/**
 * Vote de superlatifs (PR 5/9) — un tap par catégorie, pas de chiffre à
 * saisir. Chaque catégorie doit avoir un choix avant de pouvoir valider
 * (bouton désactivé tant qu'il en manque) : le serveur rejette de toute
 * façon un formulaire incomplet (`submitSuperlativeVotesAction`), mais
 * bloquer le bouton côté client évite l'aller-retour pour rien.
 *
 * Le votant ne s'affiche jamais parmi les choix possibles pour une
 * catégorie donnée — impossible de voter pour soi-même, comme demandé.
 */
export function SuperlativeVoteForm({
  sessionId,
  voterId,
  participants,
  categories,
}: {
  sessionId: string;
  voterId: string;
  participants: VoteParticipant[];
  categories: VoteCategory[];
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  const complete = categories.every((c) => selections[c.id]);
  const candidates = participants.filter((p) => p.id !== voterId);

  return (
    <form action={submitSuperlativeVotesAction} className="flex flex-col gap-5">
      <input type="hidden" name="sessionId" value={sessionId} />

      {categories.map((category) => (
        <div key={category.id} className="flex flex-col gap-2">
          <input
            type="hidden"
            name={`vote-${category.id}`}
            value={selections[category.id] ?? ""}
          />
          <div>
            <p className="font-medium text-foreground">
              {category.icon} {category.name}
            </p>
            {category.description && (
              <p className="text-xs text-muted">{category.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {candidates.map((p) => {
              const selected = selections[category.id] === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setSelections((prev) => ({ ...prev, [category.id]: p.id }))
                  }
                  className={`flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? "bg-accent text-accent-foreground"
                      : "border border-border text-foreground hover:border-border-hover hover:bg-surface-hover"
                  }`}
                >
                  <Avatar src={p.discordAvatar} alt={p.discordName} size={24} />
                  {p.discordName}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <Button type="submit" variant="primary" fullWidthOnMobile disabled={!complete}>
        Valider mes votes
      </Button>
    </form>
  );
}
