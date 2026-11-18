"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface SegmentedOption {
  key: string;
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}

/**
 * Groupe de pilules (toggle "Collectif/Individuel", "À venir/Historique",
 * mode URL/Upload…) avec fond qui glisse d'une pilule à l'autre (polish
 * visuel) — remplace le `bg-accent` posé/retiré instantanément sur
 * chaque option. Un seul `motion.span` partagé par `groupId` (isolé par
 * groupe, jamais partagé entre deux `SegmentedControl` différents)
 * anime sa position/taille entre les options via `layoutId`. Chaque
 * option est soit un lien (navigation par query param/route, le cas le
 * plus courant ici) soit un bouton (état local, ex. `BannerForm`).
 */
export function SegmentedControl({
  options,
  activeKey,
  groupId,
}: {
  options: SegmentedOption[];
  activeKey: string;
  groupId: string;
}) {
  return (
    // Mobile : les libellés ne se coupent plus en deux lignes (à 320 px,
    // « En cours » passait sur deux lignes) et chaque pilule atteint 44 px de
    // haut. Quand les options ne tiennent pas, le groupe défile
    // horizontalement au lieu de comprimer le texte.
    <div className="gn-scroll-x flex gap-2 rounded-lg border border-border bg-background p-1">
      {options.map((opt) => {
        const active = opt.key === activeKey;
        const className = `relative flex min-h-11 shrink-0 snap-start items-center justify-center rounded-md px-3 py-2 text-center text-sm font-medium transition-colors sm:flex-1 ${
          active ? "text-accent-foreground" : "text-muted hover:text-foreground"
        }`;
        const inner = (
          <>
            {active && (
              <motion.span
                layoutId={groupId}
                className="absolute inset-0 rounded-md bg-accent"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{opt.label}</span>
          </>
        );
        return opt.href ? (
          <Link key={opt.key} href={opt.href} className={className}>
            {inner}
          </Link>
        ) : (
          <button key={opt.key} type="button" onClick={opt.onClick} className={className}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
