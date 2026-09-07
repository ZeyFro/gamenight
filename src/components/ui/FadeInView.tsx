"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Fade-in au montage (design de fond) — toutes les pages qui l'utilisent
 * (`/profil` et ses sous-routes) l'appliquent au contenu ENTIER de la
 * page pour un effet d'apparition au chargement, jamais à du contenu
 * réellement hors-écran à révéler en scrollant (contrairement à
 * `RecapWrapped`, qui a un vrai besoin de scroll-reveal et garde
 * `whileInView`).
 *
 * Fix bug remonté (page /profil restant blanche en navigation client,
 * jamais au F5) — deux versions précédentes de ce composant ont chacune
 * laissé une faille :
 * 1. `whileInView` (donc un `IntersectionObserver`) : sur un montage
 *    100% côté client (navigation App Router, pas de HTML serveur à
 *    hydrater), la toute première notification de l'observateur peut
 *    être retardée par le navigateur indéfiniment jusqu'au prochain
 *    recalcul de layout — un resize/scroll en forçait un, d'où le
 *    contenu qui restait bloqué invisible jusqu'à cette interaction.
 * 2. Un `useState`+`useEffect` "monté ?" qui rendait un `<div>` simple
 *    PUIS le remplaçait par ce `motion.div` une frame plus tard : le
 *    changement de type d'élément (`div` → `motion.div`) force React à
 *    démonter/remonter le nœud, et Framer Motion applique alors `initial`
 *    (`opacity: 0`) instantanément sur ce tout nouveau nœud — d'où le
 *    contenu qui apparaît une frame, disparaît, puis se refond à
 *    l'affichage sur 0.5s (repéré par un test manuel en navigation
 *    privée : "apparaît 0.1s puis disparaît").
 *
 * Version actuelle : un seul `motion.div`, jamais démonté/remonté,
 * animé uniquement via `initial`/`animate` (jamais `whileInView`) — ce
 * couple ne dépend d'aucun observateur externe, seulement du cycle de
 * rendu/commit React lui-même, donc fiable de façon identique en
 * hydratation (hard refresh) comme en montage 100% client (navigation).
 */
export function FadeInView({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
