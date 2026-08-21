"use client";

import { useEffect, useState } from "react";
import { formatDurationFr } from "@/lib/wallclock";

/**
 * Affiche "Vote fermé dans Xh" / "Vote fermé depuis Xh" en se mettant à
 * jour toutes les 30s (pas besoin de précision à la seconde pour ce cas
 * d'usage, et ça évite de re-render inutilement). `suppressHydrationWarning`
 * car le texte dépend de l'heure exacte du rendu, qui diffère forcément
 * (de quelques secondes) entre le rendu serveur et l'hydratation client.
 */
export function VotingCountdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const deadlineMs = new Date(deadline).getTime();
  const diff = deadlineMs - now;
  const closed = diff <= 0;

  return (
    <p
      suppressHydrationWarning
      className={
        closed
          ? "text-sm text-red-600 dark:text-red-400"
          : "text-sm text-zinc-600 dark:text-zinc-400"
      }
    >
      {closed
        ? `Vote fermé depuis ${formatDurationFr(-diff)}`
        : `Vote fermé dans ${formatDurationFr(diff)}`}
    </p>
  );
}
