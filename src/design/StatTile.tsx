"use client";

import type { ReactNode } from "react";
import { BentoCard, type BentoCardProps } from "./BentoCard";

/**
 * Tuile de statistique : un chiffre en grand, son libellé, et au choix une
 * variation (`delta`) ou une précision (`hint`). Les chiffres sont en
 * `tabular-nums` pour ne pas « danser » quand ils changent.
 */

export interface StatTileProps extends Pick<BentoCardProps, "tone" | "colSpan" | "mdColSpan" | "delay"> {
  label: string;
  value: string | number;
  hint?: string;
  /** Variation : vert si `positive`, rouge sinon. */
  delta?: { text: string; positive?: boolean };
  icon?: ReactNode;
}

export function StatTile({ label, value, hint, delta, icon, ...card }: StatTileProps) {
  return (
    <BentoCard {...card} className="gn-stat">
      <div className="gn-stat-head">
        {icon ? <span className="gn-stat-icon">{icon}</span> : null}
        <p className="gn-stat-label">{label}</p>
      </div>
      <p className="gn-stat-value">{value}</p>
      {delta ? (
        <p className="gn-stat-delta" data-positive={delta.positive ? "true" : "false"}>
          {delta.text}
        </p>
      ) : null}
      {hint ? <p className="gn-stat-hint">{hint}</p> : null}
    </BentoCard>
  );
}
