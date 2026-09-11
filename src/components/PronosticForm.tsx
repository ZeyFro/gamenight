"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { submitPronosticAction } from "@/app/sessions/actions/predictions";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

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
 *
 * Mise à jour optimiste (Sprint 5 suite, I2) — le "Pronostic enregistré"
 * s'affiche dès le clic, `initialAlreadySubmitted` (calculé côté serveur,
 * `pronosticData.alreadySubmitted`) ne sert qu'à l'état initial (ex.
 * rechargement de page après un prono déjà posé une session précédente) ;
 * défait si `submitPronosticAction` échoue (rate limit), même pattern que
 * `VoteButton`.
 */
export function PronosticForm({
  sessionId,
  voterId,
  participants,
  initialAlreadySubmitted,
}: {
  sessionId: string;
  voterId: string;
  participants: PronosticParticipant[];
  initialAlreadySubmitted: boolean;
}) {
  const [predictedUserId, setPredictedUserId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(initialAlreadySubmitted);
  const [isPending, startTransition] = useTransition();
  const candidates = participants.filter((p) => p.id !== voterId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!predictedUserId) return;
    setSubmitted(true);

    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("predictedUserId", predictedUserId);

    startTransition(async () => {
      const result = await submitPronosticAction(formData);
      if (!result.ok) {
        setSubmitted(false);
        toast.error(
          result.error === RATE_LIMIT_ERROR_KEY ? RATE_LIMIT_MESSAGE : "Une erreur est survenue."
        );
      }
    });
  }

  if (submitted) {
    return (
      <p className="text-sm text-accent">
        Pronostic enregistré — réponse au tirage des récompenses.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
        disabled={!predictedUserId || isPending}
      >
        Valider mon pronostic
      </Button>
    </form>
  );
}
