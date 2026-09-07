"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Lien d'onglet avec soulignement animé (polish visuel) — remplace le
 * `border-b-2` statique posé/retiré instantanément dans `ProfilTabs`,
 * `PoteTabs`, `LibraryTabs`, `AdminTabs` : un seul `motion.span` partagé
 * par `layoutId` (isolé par barre d'onglets via ce même id, jamais
 * partagé entre deux `TabLink` de composants différents) glisse d'un
 * onglet à l'autre au lieu de réapparaître instantanément sous le
 * suivant.
 */
export function TabLink({
  href,
  active,
  layoutId,
  children,
  className = "",
}: {
  href: string;
  active: boolean;
  layoutId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`relative shrink-0 px-1 pb-3 text-sm font-medium transition-colors ${
        active ? "text-foreground" : "text-muted hover:text-foreground"
      } ${className}`}
    >
      <span className="flex items-center gap-1.5">{children}</span>
      {active && (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
    </Link>
  );
}
