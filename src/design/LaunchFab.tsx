"use client";

import { motion } from "framer-motion";
import { BoltIcon } from "./icons";
import { tokens } from "./tokens";

/**
 * Bouton central « Jouer maintenant » : rond, dégradé violet → magenta, éclair,
 * halo qui pulse doucement (CSS, coupé si l'utilisateur réduit les animations).
 * Le libellé visible sous le bouton est décoratif : le nom accessible du
 * bouton est `label`. À poser dans l'emplacement `fab` de `BottomNav`.
 */

export interface LaunchFabProps {
  label?: string;
  onPress: () => void;
  /** Renseigner si le bouton ouvre un panneau : annonce l'état aux lecteurs d'écran. */
  expanded?: boolean;
  pulse?: boolean;
}

export function LaunchFab({ label = "Jouer maintenant", onPress, expanded, pulse = true }: LaunchFabProps) {
  return (
    <div className="gn-fab-wrap">
      <motion.button
        type="button"
        className="gn-fab"
        data-pulse={pulse ? "true" : "false"}
        aria-label={label}
        aria-haspopup={expanded === undefined ? undefined : "dialog"}
        aria-expanded={expanded}
        onClick={onPress}
        whileTap={{ scale: 0.92 }}
        whileHover={{ scale: 1.05 }}
        transition={{ type: "spring", ...tokens.motion.spring.snappy }}
      >
        <span className="gn-fab-ring" aria-hidden="true" />
        <BoltIcon width={28} height={28} />
      </motion.button>
      <span className="gn-fab-caption" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
