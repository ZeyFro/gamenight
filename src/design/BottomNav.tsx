"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { tokens } from "./tokens";

/**
 * Barre de navigation basse : les onglets se répartissent de part et d'autre
 * d'un emplacement central (`fab`, typiquement `LaunchFab`) qui dépasse
 * au-dessus de la barre. Composant de présentation PUR (pas de routeur) : il
 * reçoit `activeId` et `onSelect`, comme une barre d'onglets Expo — le
 * branchement sur la navigation est fait par l'appelant.
 */

export interface BottomNavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface BottomNavProps {
  items: readonly BottomNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Bouton central (≈ 64 px) — `LaunchFab`. */
  fab: ReactNode;
  "aria-label"?: string;
}

export function BottomNav({
  items,
  activeId,
  onSelect,
  fab,
  "aria-label": ariaLabel = "Navigation principale",
}: BottomNavProps) {
  const middle = Math.ceil(items.length / 2);

  const renderItem = (item: BottomNavItem) => {
    const active = item.id === activeId;
    return (
      <button
        key={item.id}
        type="button"
        className="gn-navitem"
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(item.id)}
      >
        {active ? (
          <motion.span
            layoutId="gn-nav-indicator"
            className="gn-navitem-indicator"
            transition={{ type: "spring", ...tokens.motion.spring.snappy }}
          />
        ) : null}
        <span className="gn-navitem-icon">{item.icon}</span>
        <span className="gn-navitem-label">{item.label}</span>
      </button>
    );
  };

  return (
    <nav className="gn-bottomnav" aria-label={ariaLabel}>
      <div className="gn-bottomnav-bar">
        {items.slice(0, middle).map(renderItem)}
        <div className="gn-bottomnav-fab">{fab}</div>
        {items.slice(middle).map(renderItem)}
      </div>
    </nav>
  );
}
