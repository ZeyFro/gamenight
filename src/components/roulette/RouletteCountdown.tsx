"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatDurationFr } from "@/lib/wallclock";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Même mécanique que `VotingCountdown` (deadline dynamique, mise à jour
 * toutes les 30s, `suppressHydrationWarning`) mais texte adapté à la
 * deadline de PROPOSITION d'une roulette async plutôt qu'à un vote de
 * session — pas de composant partagé pour ces deux textes différents, la
 * duplication reste minime.
 */
export function RouletteCountdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
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
      transition={urgent ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : {}}
      className={
        closed
          ? "text-sm text-destructive"
          : urgent
            ? "text-sm font-medium text-warning"
            : "text-sm text-muted"
      }
    >
      {closed
        ? `Propositions fermées depuis ${formatDurationFr(-diff)}`
        : `Propositions fermées dans ${formatDurationFr(diff)}`}
    </motion.p>
  );
}
