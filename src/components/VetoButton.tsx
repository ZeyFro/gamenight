"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { clearVeto, setVeto } from "@/app/sessions/actions/veto";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

const ERRORS: Record<string, string> = {
  last_candidate: "Impossible : il ne resterait aucun jeu possible.",
  closed: "Le vote est terminé.",
  [RATE_LIMIT_ERROR_KEY]: RATE_LIMIT_MESSAGE,
};

export function VetoButton({ proposalId, initialVetoed }: { proposalId: string; initialVetoed: boolean }) {
  const [vetoed, setVetoed] = useOptimistic(initialVetoed);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const next = !vetoed;
    const formData = new FormData();
    formData.set("proposalId", proposalId);
    startTransition(async () => {
      setVetoed(next);
      const result = await (next ? setVeto(formData) : clearVeto(formData));
      if (!result.ok) {
        toast.error(ERRORS[result.error ?? ""] ?? "Une erreur est survenue.");
        return;
      }
      toast.success(next ? "Veto posé" : "Veto retiré");
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={vetoed}
      aria-label={vetoed ? "Retirer mon veto" : "Poser mon veto sur ce jeu"}
      className={`min-h-11 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 ${
        vetoed
          ? "bg-danger/15 text-danger border border-danger"
          : "border border-border text-foreground hover:border-border-hover hover:bg-surface-hover"
      }`}
    >
      {vetoed ? "Retirer mon veto" : "Veto"}
    </button>
  );
}
