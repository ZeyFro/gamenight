"use client";

import { motion } from "framer-motion";

export interface WheelSegment {
  key: string;
  label: string;
}

export const WHEEL_COLORS = [
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#ef4444",
];

/**
 * Calcule la rotation cible pour que le CENTRE du segment `winnerIndex`
 * atterrisse sous le pointeur fixe (en haut, 0°) — extrait de
 * `RouletteWizard` (mode instant) pour être réutilisé par la révélation
 * async (`RouletteResultReveal`), même formule exacte. Le delta ajouté à
 * `currentRotation` est toujours FORWARD (jamais négatif), pour qu'un
 * "Relancer" ne fasse jamais sauter la roue en arrière.
 */
export function computeWinningRotation(
  currentRotation: number,
  winnerIndex: number,
  segmentCount: number,
  extraSpins = 5 * 360
): number {
  const segmentAngle = 360 / segmentCount;
  const winnerCenter = winnerIndex * segmentAngle + segmentAngle / 2;
  const currentMod = ((currentRotation % 360) + 360) % 360;
  const desiredMod = (360 - winnerCenter) % 360;
  const forwardDelta = ((desiredMod - currentMod) + 360) % 360;
  return currentRotation + extraSpins + forwardDelta;
}

export function RouletteWheelDisplay({
  segments,
  rotation,
  sizePx = 280,
  durationS = 3.6,
  spinning = false,
  celebrate = false,
}: {
  segments: WheelSegment[];
  rotation: number;
  sizePx?: number;
  durationS?: number;
  /** Ondes concentriques derrière la roue pendant qu'elle tourne (design de fond, `.radar-pulse`). */
  spinning?: boolean;
  /**
   * Zoom-in bref sur la roue + flash lumineux (Amélioration des features
   * existantes, PR-B, item 6 — "plus de spectacle") — déclenché par le
   * parent juste après l'arrêt de la roue, AVANT les confettis, pour
   * marquer un temps fort avant la célébration plutôt que tout enchaîner
   * d'un coup.
   */
  celebrate?: boolean;
}) {
  const segmentPercent = segments.length > 0 ? 100 / segments.length : 100;
  const conicGradient =
    segments.length > 0
      ? `conic-gradient(${segments
          .map((_, i) => {
            const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
            return `${color} ${i * segmentPercent}% ${(i + 1) * segmentPercent}%`;
          })
          .join(", ")})`
      : "var(--surface-hover)";

  return (
    <div className="relative" style={{ width: sizePx, height: sizePx }}>
      {spinning && <span className="radar-pulse" aria-hidden />}
      <div
        className="absolute -top-1 left-1/2 z-10 -translate-x-1/2"
        style={{
          width: 0,
          height: 0,
          borderLeft: "10px solid transparent",
          borderRight: "10px solid transparent",
          borderTop: "18px solid var(--accent)",
        }}
      />
      <motion.div
        className="h-full w-full rounded-full border-4 border-border shadow-lg"
        style={{ background: conicGradient }}
        animate={{ rotate: rotation, scale: celebrate ? 1.08 : 1 }}
        transition={{
          rotate: { duration: durationS, ease: [0.12, 0.67, 0.2, 0.99] },
          scale: { duration: 0.32, ease: "easeOut" },
        }}
      >
        {segments.map((seg, i) => {
          const angle = i * (360 / segments.length) + 360 / segments.length / 2;
          return (
            <div
              key={seg.key}
              className="absolute top-1/2 left-1/2 h-0 w-0"
              style={{ transform: `rotate(${angle}deg)` }}
            >
              <span
                className="absolute top-[-7px] left-3 truncate text-[10px] font-semibold text-white"
                style={{ width: sizePx / 2 - 30 }}
              >
                {seg.label}
              </span>
            </div>
          );
        })}
      </motion.div>
      {celebrate && (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-full bg-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.85, 0] }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          aria-hidden
        />
      )}
    </div>
  );
}
