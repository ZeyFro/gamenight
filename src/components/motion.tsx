"use client";

import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

function containerVariants(staggerChildren: number): Variants {
  return {
    hidden: {},
    show: {
      transition: { staggerChildren },
    },
  };
}

/**
 * Conteneur de liste : anime ses StaggerItem enfants avec un délai
 * croissant. `staggerDelay` par défaut (0.04) pensé pour des listes
 * (plusieurs dizaines d'items, délai cumulé qui doit rester court) —
 * refonte home : sections peu nombreuses (6), délai plus perceptible
 * (~100ms) demandé explicitement entre chaque card.
 */
export function Stagger({
  children,
  className = "",
  staggerDelay = 0.04,
}: {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}) {
  return (
    <motion.div
      variants={containerVariants(staggerDelay)}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

export function StaggerItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  );
}

/** Pop d'apparition pour un élément isolé (ex. nouvelle puce de créneau). */
export function PopIn({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
