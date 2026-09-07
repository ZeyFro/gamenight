"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Fade-in + slide-up déclenché au scroll (design de fond) — `whileInView`
 * plutôt que `Stagger`/`StaggerItem` (qui animent au montage, pas au
 * scroll) : usage distinct et complémentaire, posé sur les sections déjà
 * visibles au chargement (pas d'effet, `viewport.once` les laisse déjà
 * affichées) et sur celles plus bas dans la page, qui apparaissent en
 * scrollant. `amount: 0.2` déclenche dès qu'un cinquième de la section
 * est visible, pas besoin d'attendre qu'elle soit entièrement dans le
 * cadre.
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
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
