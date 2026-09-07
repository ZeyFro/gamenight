"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

/**
 * Compteur qui monte de 0 à `value` à l'affichage (polish visuel) — XP,
 * soirées jouées, jeux en biblio, etc. Anime une `MotionValue` plutôt que
 * du `useState` + `requestAnimationFrame` maison : Framer Motion gère déjà
 * l'easing/l'annulation proprement, et binder la valeur directement en
 * enfant de `motion.span` évite un re-render React à chaque frame (Framer
 * met à jour le DOM lui-même). Saute l'animation (affiche `value`
 * directement) si `prefers-reduced-motion` est actif.
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
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => Math.round(v).toLocaleString("fr-FR"));

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      motionVal.set(value);
      return;
    }
    const controls = animate(motionVal, value, { duration: durationMs / 1000, ease: "easeOut" });
    return controls.stop;
  }, [value, durationMs, motionVal]);

  return <motion.span className={className}>{rounded}</motion.span>;
}
