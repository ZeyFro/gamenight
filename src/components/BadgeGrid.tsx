"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { BadgeCategory, BadgeRarity } from "@prisma/client";
import { RARITY_LABELS } from "@/lib/badge-rarity";
import { formatDateFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/motion";

export interface BadgeGridItem {
  id: string;
  icon: string;
  name: string;
  description: string;
  category: BadgeCategory;
  rarity: BadgeRarity;
  unlockedAt: Date | null;
}

const RARITY_BORDER_CLASSES: Record<BadgeRarity, string> = {
  COMMON: "border-border",
  RARE: "border-accent/40 badge-glow",
  EPIC: "border-accent/70 badge-glow-epic",
  LEGENDARY: "border-accent",
};

/**
 * Halo pulsant réservé à LEGENDARY — anime l'opacité d'une couche
 * `box-shadow` statique plutôt que le `box-shadow` lui-même (une chaîne
 * CSS composite s'interpole moins proprement en Framer Motion qu'un
 * simple nombre). Respecte `prefers-reduced-motion` via
 * `useReducedMotion` : pas d'animation JS continue pour qui l'a demandé
 * — "attention à ne pas surcharger" incluait ça.
 */
function LegendaryPulse() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-xl"
      style={{
        boxShadow:
          "0 0 26px -2px color-mix(in srgb, var(--accent) 95%, transparent)",
      }}
      animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.35, 0.9, 0.35] }}
      transition={
        reduceMotion ? undefined : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
      }
    />
  );
}

function BadgeTile({ badge }: { badge: BadgeGridItem }) {
  const locked = !badge.unlockedAt;

  return (
    <Card
      className={`relative flex flex-col items-center gap-1.5 overflow-hidden text-center ${
        locked ? "border-border" : RARITY_BORDER_CLASSES[badge.rarity]
      }`}
    >
      {!locked && badge.rarity === "LEGENDARY" && <LegendaryPulse />}
      <span
        className={`text-3xl ${locked ? "opacity-40 grayscale" : ""}`}
        aria-hidden
      >
        {badge.icon}
      </span>
      <p
        className={`text-sm font-medium ${locked ? "text-muted" : "text-foreground"}`}
      >
        {badge.name}
      </p>
      <p className="text-xs text-faint">{badge.description}</p>
      <p className="mt-1 text-[11px] font-medium text-muted">
        {RARITY_LABELS[badge.rarity]}
      </p>
      {badge.unlockedAt && (
        <p className="text-[11px] text-faint">
          Débloqué le {formatDateFr(badge.unlockedAt)}
        </p>
      )}
    </Card>
  );
}

/**
 * Grille de badges — partagée entre `/profil` (les siens) et
 * `/potes/[id]/badges` (ceux d'un pote, lecture seule dans les deux cas,
 * aucune action possible sur un badge). Les badges non débloqués
 * s'affichent grisés (icône en niveaux de gris, pas de bordure/glow de
 * rareté — annoncer une rareté qu'on n'a pas encore méritée serait
 * trompeur).
 */
export function BadgeGrid({ badges }: { badges: BadgeGridItem[] }) {
  if (badges.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">Aucun badge configuré pour l&apos;instant.</p>
      </Card>
    );
  }

  return (
    <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
      {badges.map((badge) => (
        <StaggerItem key={badge.id}>
          <BadgeTile badge={badge} />
        </StaggerItem>
      ))}
    </Stagger>
  );
}
