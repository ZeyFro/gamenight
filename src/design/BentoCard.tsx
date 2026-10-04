"use client";

import { motion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

/**
 * Carte de la grille bento — verre dépoli, rayon large, teinte au choix.
 *
 * Mobile-first : la grille (`BentoGrid`) fait 2 colonnes, `colSpan` (1 ou 2)
 * dit combien la carte en prend ; à partir de 768 px la grille passe à 4
 * colonnes et `mdColSpan` (1 à 4) reprend la main. Si la carte reçoit
 * `onPress`, elle devient un vrai `<button>` (clavier, focus, appui animé).
 *
 * Animation : l'entrée est en CSS pur (fondu + montée, `design.css`) — jamais
 * `whileInView` (bug connu : contenu invisible tant que l'observateur ne
 * s'est pas déclenché). Framer Motion ne sert qu'à l'appui (`whileTap`).
 */

export type BentoTone = "default" | "violet" | "magenta" | "gold";

export interface BentoCardProps {
  children: ReactNode;
  tone?: BentoTone;
  colSpan?: 1 | 2;
  mdColSpan?: 1 | 2 | 3 | 4;
  rowSpan?: 1 | 2;
  /** Délai de l'animation d'entrée, en ms (cascade entre cartes). */
  delay?: number;
  /** Rend la carte cliquable (élément `<button>`). */
  onPress?: () => void;
  className?: string;
  "aria-label"?: string;
}

export function BentoGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`gn-bento ${className}`.trim()}>{children}</div>;
}

export function BentoCard({
  children,
  tone = "default",
  colSpan = 1,
  mdColSpan,
  rowSpan = 1,
  delay = 0,
  onPress,
  className = "",
  "aria-label": ariaLabel,
}: BentoCardProps) {
  const common = {
    className: `gn-bento-card ${className}`.trim(),
    "data-tone": tone,
    "data-col": colSpan,
    "data-md-col": mdColSpan,
    "data-row": rowSpan,
    "aria-label": ariaLabel,
    style: { "--gn-delay": `${delay}ms` } as CSSProperties,
  };

  if (onPress) {
    return (
      <motion.button
        type="button"
        {...common}
        data-interactive="true"
        onClick={onPress}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
      >
        {children}
      </motion.button>
    );
  }

  return <div {...common}>{children}</div>;
}
