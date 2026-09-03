"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { submitPronosticAction } from "@/app/sessions/actions";

export interface PronosticParticipant {
  id: string;
  discordName: string;
  discordAvatar: string | null;
}

/**
 * Sprint 4 (FEATURE 1, Pronostics) — "🔮 Qui va carry ?" sur une soirée
 * `SCHEDULED`. Même mécanique de sélection (tap un avatar → highlight →
 * un seul bouton "Valider") que `SuperlativeVoteForm`, mais un seul choix
 * au lieu d'une catégorie par superlatif.
 */
export function PronosticForm({
  sessionId,
  voterId,
  participants,
}: {
  sessionId: string;
  voterId: string;
  participants: PronosticParticipant[];
}) {
  const [predictedUserId, setPredictedUserId] = useState<string | null>(null);
  const candidates = participants.filter((p) => p.id !== voterId);

  return (
    <form action={submitPronosticAction} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="predictedUserId" value={predictedUserId ?? ""} />

      <div className="flex flex-wrap gap-2">
        {candidates.map((p) => {
          const selected = predictedUserId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPredictedUserId(p.id)}
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

      <Button
        type="submit"
        variant="primary"
        size="sm"
        fullWidthOnMobile
        disabled={!predictedUserId}
      >
        Valider mon pronostic
      </Button>
    </form>
  );
}
