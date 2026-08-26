"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Avatar } from "@/components/ui/Avatar";
import type { Rank } from "@/lib/xp";

/**
 * Halo pulsant réservé au rang Légende (PR 8/9) — même technique que
 * `LegendaryPulse` dans `BadgeGrid.tsx` (anime l'opacité d'une couche
 * `box-shadow` statique plutôt que le `box-shadow` lui-même, plus stable
 * à interpoler), pas dupliquée en composant partagé exprès : les deux
 * usages (anneau circulaire vs carte rectangulaire) ont des géométries
 * assez différentes pour ne pas justifier une abstraction commune.
 * Respecte `prefers-reduced-motion`.
 */
function LegendaryGlow() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute -inset-1.5 rounded-full"
      style={{
        boxShadow:
          "0 0 24px -2px color-mix(in srgb, var(--accent) 95%, transparent)",
      }}
      animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.4, 0.9, 0.4] }}
      transition={
        reduceMotion ? undefined : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
      }
    />
  );
}

/**
 * Avatar avec anneau coloré selon le rang + pastille de niveau (PR 8/9,
 * refonte profil rich) — partagé entre `/profil` et `/potes/[id]` pour
 * qu'un avatar coloré signifie toujours la même chose partout dans
 * l'app.
 */
export function RankAvatar({
  src,
  alt,
  level,
  rank,
  size = 96,
}: {
  src: string | null;
  alt: string;
  level: number;
  rank: Rank;
  size?: number;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {rank.glowing && <LegendaryGlow />}
      <Avatar
        src={src}
        alt={alt}
        size={size}
        className={`ring-4 ring-offset-2 ring-offset-background ${rank.ringClass}`}
      />
      <span
        title={`Niveau ${level}`}
        aria-label={`Niveau ${level}`}
        className="absolute -bottom-1 -right-1 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-background bg-accent px-1.5 text-xs font-bold text-accent-foreground"
      >
        {level}
      </span>
    </div>
  );
}
