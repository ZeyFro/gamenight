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
