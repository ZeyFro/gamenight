"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";

/**
 * Confettis légers sur le podium du classement (amélioration classement)
 * — déclenché une seule fois au premier chargement de `/classement`, pas
 * à chaque changement de période (`?periode=`) : ce composant est monté
 * une fois par visite de page (pas de query-param dans ses props), un
 * changement de filtre ne le démonte/remonte pas puisqu'il vit à côté du
 * podium, pas dedans. Réglages `canvas-confetti` volontairement discrets
 * (peu de particules, `gravity`/`startVelocity` bas, `origin` en haut de
 * l'écran) pour un effet "tombe doucement" plutôt qu'une explosion —
 * distinct de `CelebrationConfetti` (`?celebrate=`), qui est un vrai
 * burst pour une victoire ponctuelle, pas adapté à un effet d'ambiance
 * rejoué à chaque visite de la page.
 */
export function PodiumConfetti() {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void confetti({
        particleCount: 40,
        spread: 90,
        startVelocity: 18,
        gravity: 0.5,
        ticks: 250,
        origin: { x: 0.5, y: -0.1 },
        colors: ["#8b5cf6", "#fbbf24", "#e5e7eb", "#f97316"],
        scalar: 0.8,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
