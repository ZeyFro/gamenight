"use client";

import { useEffect, useState } from "react";
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
 * jamais au F5 — indice du testeur : un resize de fenêtre la fait
 * réapparaître) — l'ancienne version pilotait l'animation via
 * `whileInView` (donc un `IntersectionObserver`) : sur un montage 100%
 * côté client (navigation App Router, pas de HTML serveur à hydrater),
 * la toute première notification de l'observateur peut être retardée par
 * le navigateur indéfiniment jusqu'au prochain recalcul de layout — un
 * `resize` ou un scroll en forcent un, ce qui explique exactement le
 * symptôme. Remplacé par un déclenchement au montage via `useEffect`
 * (garanti de s'exécuter après le commit, hard refresh comme navigation
 * client, sans dépendre d'un observateur externe) : le contenu est
 * TOUJOURS rendu dès le premier rendu (jamais masqué en attendant un
 * évènement), seule l'animation d'entrée est retardée d'une frame.
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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!visible) {
    return <div className={className}>{children}</div>;
  }

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
