"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatDurationFr, wallClockNowMs } from "@/lib/wallclock";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Affiche "Vote fermé dans Xh" / "Vote fermé depuis Xh" en se mettant à
 * jour toutes les 30s (pas besoin de précision à la seconde pour ce cas
 * d'usage, et ça évite de re-render inutilement). `suppressHydrationWarning`
 * car le texte dépend de l'heure exacte du rendu, qui diffère forcément
 * (de quelques secondes) entre le rendu serveur et l'hydratation client.
 * Pulse discret + couleur ambre quand il reste moins d'1h.
 */
export function VotingCountdown({ deadline }: { deadline: string }) {
  // `deadline` est une heure murale de Paris (deadline de vote ou date de
  // soirée) : la comparer à `Date.now()` la décalait de 1-2 h. On lit donc
  // « maintenant » dans la même convention que la deadline.
  const [now, setNow] = useState(wallClockNowMs);

  useEffect(() => {
    const interval = setInterval(() => setNow(wallClockNowMs()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const deadlineMs = new Date(deadline).getTime();
  const diff = deadlineMs - now;
  const closed = diff <= 0;
  const urgent = !closed && diff < HOUR_MS;

  return (
    <motion.p
      suppressHydrationWarning
      animate={urgent ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
      transition={
        urgent ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : {}
      }
      className={
        closed
          ? "text-sm text-destructive"
          : urgent
            ? "text-sm font-medium text-warning"
            : "text-sm text-muted"
      }
    >
      {closed
        ? `Vote fermé depuis ${formatDurationFr(-diff)}`
        : `Vote fermé dans ${formatDurationFr(diff)}`}
    </motion.p>
  );
}
