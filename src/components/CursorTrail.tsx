"use client";

import { useEffect, useRef } from "react";
import { CURSOR_TRAIL_EVENT, isCursorTrailEnabled } from "@/lib/cursor-trail-preference";

const TRAIL_LENGTH = 5;
const DOT_LIFETIME_MS = 400;

/**
 * Traînée de points violets qui suit le curseur (design de fond, desktop
 * uniquement — `pointer: fine`, jamais sur tactile où il n'y a pas de
 * curseur). Manipule le DOM directement plutôt que du state React : un
 * `mousemove` peut se déclencher des dizaines de fois par seconde,
 * passer par `setState`/le rendu React à cette fréquence pour recycler 5
 * `div` coûterait cher pour rien (aucune de ces mises à jour n'a besoin
 * de réconciliation). Relit le réglage (`isCursorTrailEnabled`) à chaque
 * évènement `CURSOR_TRAIL_EVENT` (même onglet, déclenché par le toggle
 * dans les réglages) ou `storage` (autre onglet), pas seulement au
 * montage.
 */
export function CursorTrail() {
  const dotsRef = useRef<HTMLDivElement[]>([]);
  const timeoutsRef = useRef<number[]>([]);
  const enabledRef = useRef(false);
  const indexRef = useRef(0);

  useEffect(() => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const dot = document.createElement("div");
      dot.className = "cursor-trail-dot";
      dot.style.opacity = "0";
      container.appendChild(dot);
      dotsRef.current.push(dot);
      timeoutsRef.current.push(0);
    }

    function refreshEnabled() {
      enabledRef.current =
        window.matchMedia("(pointer: fine)").matches && isCursorTrailEnabled();
      if (!enabledRef.current) {
        for (const dot of dotsRef.current) dot.style.opacity = "0";
      }
    }
    refreshEnabled();

    function handleMove(e: MouseEvent) {
      if (!enabledRef.current) return;
      const i = indexRef.current % TRAIL_LENGTH;
      indexRef.current += 1;
      const dot = dotsRef.current[i];
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
      dot.style.opacity = "0.6";
      window.clearTimeout(timeoutsRef.current[i]);
      timeoutsRef.current[i] = window.setTimeout(() => {
        dot.style.opacity = "0";
      }, DOT_LIFETIME_MS);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener(CURSOR_TRAIL_EVENT, refreshEnabled);
    window.addEventListener("storage", refreshEnabled);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener(CURSOR_TRAIL_EVENT, refreshEnabled);
      window.removeEventListener("storage", refreshEnabled);
      for (const t of timeoutsRef.current) window.clearTimeout(t);
      container.remove();
      dotsRef.current = [];
      timeoutsRef.current = [];
    };
  }, []);

  return null;
}
