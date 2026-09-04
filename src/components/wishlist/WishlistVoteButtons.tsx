"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { voteWishlistAction } from "@/app/wishlist/actions";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/**
 * Mise à jour optimiste (Sprint 5 suite, I2) — même pattern que
 * `VoteButton` (src/components/VoteButton.tsx) : le bouton cliqué passe
 * actif immédiatement (et le badge "X/6 intéressés" suit dans la foulée,
 * les deux vivent dans le même état local pour ne jamais désynchroniser),
 * défait + toast d'erreur si l'action serveur échoue (rate limit).
 */
export function WishlistVoteButtons({
  wishlistId,
  totalUsers,
  initialMyVote,
  initialInterestedCount,
}: {
  wishlistId: string;
  totalUsers: number;
  initialMyVote: boolean | null;
  initialInterestedCount: number;
}) {
  const [myVote, setMyVote] = useState(initialMyVote);
  const [interestedCount, setInterestedCount] = useState(initialInterestedCount);
  const [, startTransition] = useTransition();
  const majority = interestedCount > totalUsers / 2;

  function vote(interested: boolean) {
    if (myVote === interested) return;
    const previousVote = myVote;
    const previousCount = interestedCount;

    let nextCount = interestedCount;
    if (previousVote === true) nextCount -= 1;
    if (interested) nextCount += 1;

    setMyVote(interested);
    setInterestedCount(nextCount);

    const formData = new FormData();
    formData.set("wishlistId", wishlistId);
    formData.set("interested", String(interested));

    startTransition(async () => {
      const result = await voteWishlistAction(formData);
      if (!result.ok) {
        setMyVote(previousVote);
        setInterestedCount(previousCount);
        toast.error(
          result.error === RATE_LIMIT_ERROR_KEY ? RATE_LIMIT_MESSAGE : "Une erreur est survenue."
        );
      }
    });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        onClick={() => vote(true)}
        variant={myVote === true ? "primary" : "secondary"}
        size="sm"
      >
        Intéressé 👍
      </Button>
      <Button
        type="button"
        onClick={() => vote(false)}
        variant={myVote === false ? "primary" : "secondary"}
        size="sm"
      >
        Pas pour moi 👎
      </Button>
      <span
        className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
          majority ? "bg-accent/15 text-accent" : "bg-surface-hover text-muted"
        }`}
      >
        {interestedCount}/{totalUsers} intéressés
      </span>
    </div>
  );
}
