"use client";

import { useEffect, useState } from "react";
import { animate } from "framer-motion";

/**
 * Compteur qui monte de 0 à `value` à l'affichage (polish visuel) — XP,
 * soirées jouées, jeux en biblio, etc.
 *
 * Fix bug remonté (PR #65, page /profil blanche sur desktop) — la version
 * précédente rendait une `MotionValue` directement comme enfant de
 * `motion.span` (`useTransform` + `<motion.span>{rounded}</motion.span>`).
 * `value` initial state ci-dessous : toujours `0`, calculé sans accéder à
 * `window`/`document` pendant le rendu (seul le `useEffect` y touche, donc
 * jamais exécuté côté serveur) — rendu serveur et client identiques au
 * premier passage, aucun risque de mismatch d'hydratation.
 */
export function CountUp({
  value,
  durationMs = 600,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const controls = animate(0, value, {
      duration: reduceMotion ? 0 : durationMs / 1000,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return controls.stop;
  }, [value, durationMs]);

  return <span className={className}>{display.toLocaleString("fr-FR")}</span>;
}
