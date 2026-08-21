"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { toggleVote } from "@/app/sessions/actions";

export function VoteButton({
  proposalId,
  sessionId,
  initialVoted,
  initialCount,
  disabled,
}: {
  proposalId: string;
  sessionId: string;
  initialVoted: boolean;
  initialCount: number;
  disabled: boolean;
}) {
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const nextVoted = !voted;
    setVoted(nextVoted);
    setCount((c) => c + (nextVoted ? 1 : -1));

    const formData = new FormData();
    formData.set("proposalId", proposalId);
    formData.set("sessionId", sessionId);

    startTransition(async () => {
      await toggleVote(formData);
      toast.success(nextVoted ? "Vote enregistré" : "Vote retiré");
    });
  }

  return (
    <div className="flex items-center justify-between">
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={disabled || isPending}
        whileTap={{ scale: 0.97 }}
        animate={voted ? { scale: [1, 1.1, 1] } : { scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
          voted
            ? "bg-accent text-accent-foreground"
            : "border border-border text-foreground hover:border-border-hover hover:bg-surface-hover"
        }`}
      >
        {voted ? "✓ Voté" : "Voter"}
      </motion.button>
      <motion.p
        key={count}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="text-sm text-muted"
      >
        {count} vote{count > 1 ? "s" : ""}
      </motion.p>
    </div>
  );
}
