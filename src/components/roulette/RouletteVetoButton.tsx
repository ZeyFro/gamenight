"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { vetoRouletteAction } from "@/app/roulette/actions";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

const ERRORS: Record<string, string> = {
  no_candidate: "Impossible : il ne reste aucun autre jeu à tirer.",
  closed: "La soirée n'accepte plus de veto.",
  already_vetoed: "Tu as déjà utilisé ton veto.",
  not_participant: "Seuls les participants peuvent vetoer.",
  [RATE_LIMIT_ERROR_KEY]: RATE_LIMIT_MESSAGE,
};

/** Veto du jeu tiré (un seul par participant) : la roue relance sans les jeux vetoés. */
export function RouletteVetoButton({ rouletteId }: { rouletteId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm("Vetoer ce jeu ? La roue relancera, et tu ne pourras plus vetoer.")) return;
    const formData = new FormData();
    formData.set("rouletteId", rouletteId);
    startTransition(async () => {
      const result = await vetoRouletteAction(formData);
      if (!result.ok) {
        toast.error(ERRORS[result.error ?? ""] ?? "Une erreur est survenue.");
        return;
      }
      toast.success(result.playerFilterFallback ? "Nouveau jeu tiré (aucun ne convenait au nombre de joueurs)" : "Nouveau jeu tiré");
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="min-h-11 w-full rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:border-border-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 sm:w-auto"
    >
      {isPending ? "Relance…" : "Veto : relancer sans ce jeu"}
    </button>
  );
}
