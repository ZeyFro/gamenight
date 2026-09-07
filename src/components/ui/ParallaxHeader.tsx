"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Parallax léger sur les en-têtes de page (design de fond) — le contenu
 * englobé translate verticalement à ~0.3x la vitesse du scroll de la
 * page (`useScroll` sans `target` = scroll du document entier, pas d'un
 * conteneur précis — les en-têtes visés sont tous en haut de page).
 * `transform` uniquement (jamais de `top`/`margin`) : géré par le
 * compositeur GPU, aucun reflow — coût quasi nul même sur mobile,
 * contrairement à un scroll-listener qui repositionnerait via le layout.
 *
 * Ce composant lie `scrollY` uniquement au `style` (jamais comme enfant
 * React) et son code source (`useScroll` de Framer Motion) confirme
 * qu'il ne touche `window` que dans des effets, jamais pendant le rendu
 * — SSR-safe par construction, sans garde de montage nécessaire (un
 * ancien `useSyncExternalStore` "monté ?" ajouté ici par précaution a été
 * retiré : ce genre de garde qui bascule d'un `<div>` vers `<motion.div>`
 * une frame plus tard est ce qui causait le vrai bug ailleurs dans le
 * design de fond, cf. `FadeInView` — un changement de type d'élément
 * force React à démonter/remonter le nœud).
 */
export function ParallaxHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 300], [0, -90]);

  return (
    <motion.div style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}
