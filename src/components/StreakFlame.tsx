"use client";

import { motion, useReducedMotion } from "framer-motion";

/** Petite flamme animée quand le streak est > 0 (PR 8/9, carte stat profil). */
export function StreakFlame() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      className="inline-block"
      animate={reduceMotion ? undefined : { scale: [1, 1.15, 1], rotate: [0, -4, 4, 0] }}
      transition={
        reduceMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
      }
    >
      🔥
    </motion.span>
  );
}
