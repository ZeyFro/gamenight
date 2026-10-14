"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface XpEvolutionPoint {
  /** Étiquette courte affichée sur l'axe X (ex. "12/09"). */
  label: string;
  /** XP total cumulé à cette date. */
  xp: number;
}

/**
 * Courbe d'évolution de l'XP total sur les 30 derniers jours (amélioration
 * profil) — Recharts plutôt qu'un composant maison : rendu SVG déjà
 * accessible/responsive, pas besoin de gérer soi-même les échelles. Simple
 * `LineChart` (pas d'aire/barres) : une seule série, la lisibilité prime
 * sur l'esthétique pour ce genre de mini-graphe de stats. `ResponsiveContainer`
 * avec une hauteur fixe (par CSS sur le parent) pour rester mobile-first
 * sans jamais déborder de la Card qui l'englobe.
 */
export function XpEvolutionChart({ data }: { data: XpEvolutionPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--foreground)" }}
          formatter={(value) => [`${value} XP`, "Total"]}
        />
        <Line
          type="monotone"
          dataKey="xp"
          stroke="#8b5cf6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
