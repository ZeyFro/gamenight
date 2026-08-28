"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { batchMarkGamesCoop } from "@/app/bibliotheque/actions";
import { Button } from "@/components/ui/Button";

/**
 * Bonus de l'onglet `/bibliotheque` (PR 32.6, Bloc B) : affiché uniquement
 * quand le filtre "Coop" est le seul filtre de mode actif — confirme
 * `playInfoManual` d'un coup sur toute la liste actuellement affichée,
 * pour protéger ces jeux du prochain backfill automatique.
 */
export function MarkAllCoopButton({ gameIds }: { gameIds: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (gameIds.length === 0) return null;

  function handleClick() {
    startTransition(async () => {
      const result = await batchMarkGamesCoop(gameIds);
      toast.success(
        `${result.count} jeu${result.count === 1 ? "" : "x"} confirmé${result.count === 1 ? "" : "s"} en coop`
      );
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleClick}
      disabled={isPending}
      className="text-sm"
    >
      {isPending
        ? "Confirmation…"
        : `Marquer les ${gameIds.length} jeux affichés comme coop`}
    </Button>
  );
}
