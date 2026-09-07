"use client";

import { useSyncExternalStore } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import type { ReactNode } from "react";

function subscribeNever() {
  return () => {};
}

/**
 * Parallax léger sur les en-têtes de page (design de fond) — le contenu
 * englobé translate verticalement à ~0.3x la vitesse du scroll de la
 * page (`useScroll` sans `target` = scroll du document entier, pas d'un
 * conteneur précis — les en-têtes visés sont tous en haut de page).
 * `transform` uniquement (jamais de `top`/`margin`) : géré par le
 * compositeur GPU, aucun reflow — coût quasi nul même sur mobile,
 * contrairement à un scroll-listener qui repositionnerait via le layout.
 *
 * Fix bug remonté (page /profil blanche uniquement en navigation client,
 * jamais au hard refresh) — `mounted` retarde le rendu lié à `scrollY`
 * (une `MotionValue` alimentée par un `useScroll` document-entier) au
 * premier effet plutôt que dès le tout premier rendu : ce premier rendu
 * client d'une navigation App Router (contrairement à l'hydratation d'un
 * hard refresh, qui rejoue un rendu déjà produit côté serveur) est un
 * rendu "à froid" où l'état de scroll hérité de la page précédente n'a
 * pas encore été mesuré par Framer Motion — écarter tout rendu dépendant
 * de `scrollY` avant ce premier rendu monté élimine ce cas de figure sans
 * changer le rendu final (le contenu s'affiche identique, juste sans le
 * décalage parallax pendant une fraction de frame). `useSyncExternalStore`
 * plutôt qu'un `useState`+`useEffect` maison (même technique que
 * `CursorTrailToggle`) : le flip false→true se fait via le mécanisme de
 * resynchronisation de React lui-même après l'hydratation, pas un
 * `setState` synchrone dans le corps de l'effet (`react-hooks/set-state-
 * in-effect`).
 */
export function ParallaxHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );

  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 300], [0, -90]);

  if (!mounted) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}
