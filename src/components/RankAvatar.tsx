"use client";

import { useState } from "react";
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
 *
 * Fix UX (PR 9/9, suite au test prod de la PR 8/9) : l'anneau coloré
 * n'expliquait pas ce qu'il représentait. Tooltip au hover (desktop, via
 * `group-hover`) ou au tap (mobile, pas de vrai `:hover` sur tactile —
 * `onClick` bascule un état local, refermé au `onBlur`) plutôt qu'un
 * composant Radix Tooltip dédié : pas de dépendance supplémentaire pour
 * un seul usage, `title` HTML natif étant lui insuffisant (pas fiable au
 * tap-hold selon les navigateurs mobiles, et pas stylable).
 */
export function RankAvatar({
  src,
  alt,
  level,
  rank,
  frameColor,
  size = 96,
}: {
  src: string | null;
  alt: string;
  level: number;
  rank: Rank;
  frameColor?: string | null;
  size?: number;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {rank.glowing && <LegendaryGlow />}
      {frameColor && <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full border-2" style={{ borderColor: frameColor }} />}
      <button
        type="button"
        onClick={() => setTooltipOpen((open) => !open)}
        onBlur={() => setTooltipOpen(false)}
        aria-label={`Rang : ${rank.name} — accédé au niveau ${rank.minLevel}`}
        className="group/rank block cursor-pointer rounded-full border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar
          src={src}
          alt={alt}
          size={size}
          className={`ring-4 ring-offset-2 ring-offset-background ${rank.ringClass}`}
        />
        <span
          role="tooltip"
          aria-hidden={!tooltipOpen}
          className={`pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-normal text-foreground shadow-lg transition-opacity duration-150 ${tooltipOpen ? "block opacity-100" : "hidden opacity-0 group-hover/rank:block group-focus-visible/rank:block group-hover/rank:opacity-100 group-focus-visible/rank:opacity-100"}`}
        >
          Rang : {rank.name} — accédé au niveau {rank.minLevel}
        </span>
      </button>
      <span
        title={`Niveau ${level}`}
        aria-label={`Niveau ${level}`}
        className="pointer-events-none absolute -bottom-1 -right-1 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-background bg-accent px-1.5 text-xs font-bold text-accent-foreground"
      >
        {level}
      </span>
    </div>
  );
}
