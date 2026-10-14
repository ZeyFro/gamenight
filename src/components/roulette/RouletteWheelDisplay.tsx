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

/**
 * Angle (convention `conic-gradient`, 0° = midi/haut, sens horaire) du
 * CENTRE du secteur `index` sur une roue à `segmentCount` parts — même
 * formule que `computeWinningRotation` ci-dessus, partagée pour garantir
 * qu'un libellé pointe TOUJOURS vers le secteur qu'il nomme, jamais un
 * autre.
 */
export function segmentCenterAngle(index: number, segmentCount: number): number {
  const segmentAngle = 360 / segmentCount;
  return index * segmentAngle + segmentAngle / 2;
}

/**
 * Bug remonté en test réel — les libellés se chevauchaient au centre et
 * étaient mal orientés. Cause : chaque libellé était positionné avec un
 * décalage `left` (donc pointant par défaut vers l'EST/3h avant rotation,
 * angle 90° en convention `conic-gradient`) puis pivoté de l'angle du
 * secteur tel quel (convention `conic-gradient`, 0° = NORD/midi) — un
 * décalage SYSTÉMATIQUE de 90° entre l'orientation réelle du secteur et
 * celle du libellé qui est censé le nommer. `-90` corrige exactement cet
 * écart : à `segmentAngle = 0` (secteur tout en haut), le libellé pointe
 * maintenant bien vers le haut, jamais vers la droite.
 *
 * Second bug trouvé à la VÉRIFICATION VISUELLE (Playwright, voir la PR) —
 * la correction de -90 seule laisse chaque libellé de la MOITIÉ GAUCHE du
 * disque (`segmentAngle` entre 180° et 360°) la tête en bas, illisible :
 * une rotation de plus de 90° dans un sens ou l'autre retourne le texte à
 * l'écran. `+180` supplémentaire pour cette moitié garde le texte à
 * l'endroit — voir `labelIsFlipped`, qui indique au composant d'ancrer le
 * libellé par la droite plutôt que par la gauche dans ce cas (sans ce
 * second ajustement, le texte remonterait à l'envers vers le CENTRE au
 * lieu de rayonner vers le bord).
 */
export function labelRotationDeg(segmentAngle: number): number {
  const base = segmentAngle - 90;
  return segmentAngle > 180 ? base + 180 : base;
}

/** Voir `labelRotationDeg` — vrai pour la moitié gauche du disque, où le
 * libellé est ancré par la droite (`right`) plutôt que par la gauche pour
 * continuer à rayonner vers le bord malgré le +180 de retournement. */
export function labelIsFlipped(segmentAngle: number): boolean {
  return segmentAngle > 180;
}

/**
 * Taille de police et rayon de départ du libellé, adaptés au NOMBRE de
 * secteurs — bug remonté en test réel : à taille fixe, les libellés de
 * roues à beaucoup de secteurs (groupe nombreux, 2 jeux/participant)
 * s'entassent près du centre et deviennent illisibles même une fois
 * l'orientation corrigée (l'arc disponible près du centre RÉTRÉCIT avec
 * le nombre de secteurs, jamais leur longueur radiale). Purement fonction
 * de `segmentCount`, jamais de la taille de rendu réelle (`sizePx` ne sert
 * plus qu'à borner la largeur CSS du conteneur, voir le composant) — les
 * pourcentages ci-dessous restent corrects à N'IMPORTE QUELLE taille
 * affichée (mobile compris), contrairement à l'ancien calcul en pixels
 * bruts (`sizePx / 2 - 30`), qui ne s'adaptait jamais à un conteneur
 * redimensionné en CSS pur.
 */
export function labelLayout(segmentCount: number): {
  fontSizePx: number;
  startPercent: number;
  widthPercent: number;
} {
  const fontSizePx = Math.max(7, Math.min(11, 12 - segmentCount * 0.18));
  const startPercent = Math.min(14, 6 + segmentCount * 0.25);
  const widthPercent = Math.max(16, 40 - segmentCount * 0.7);
  return { fontSizePx, startPercent, widthPercent };
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

  const { fontSizePx, startPercent, widthPercent } = labelLayout(segments.length);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Bug remonté en test réel — taille fixe (280px) débordait sur
          petit écran ; `w-full` + `max-w-*` (borné par `sizePx`, même
          défaut qu'avant) + `aspect-square` laisse le CSS rétrécir la
          roue sur mobile sans jamais la déformer, aucun JS de mesure de
          viewport nécessaire. Les libellés ci-dessous sont positionnés en
          POURCENTAGE (jamais en pixels bruts) : ils restent alignés sur
          leur secteur à n'importe quelle taille réellement rendue. */}
      <div
        className="relative aspect-square w-full"
        style={{ maxWidth: sizePx }}
      >
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
            const angle = segmentCenterAngle(i, segments.length);
            const flipped = labelIsFlipped(angle);
            return (
              // Bug remonté en test réel (corrigé après vérification
              // visuelle Playwright — voir le commentaire de fichier) :
              // un ancre de taille NULLE (`h-0 w-0`, forme d'origine)
              // pivote correctement, mais réduit à 0px la largeur dont
              // hérite tout `%` posé sur son enfant — les libellés
              // devenaient invisibles. L'ancre couvre maintenant TOUT le
              // disque (`inset-0`) : même pivot (son centre reste celui
              // du disque, `transform-origin` par défaut), mais son
              // enfant a désormais une vraie largeur de référence pour
              // ses `%`.
              <div
                key={seg.key}
                className="absolute inset-0"
                style={{ transform: `rotate(${labelRotationDeg(angle)}deg)` }}
              >
                <span
                  className="absolute truncate font-semibold text-white"
                  style={{
                    top: `calc(50% - ${fontSizePx * 0.7}px)`,
                    // Moitié gauche du disque (`flipped`, voir
                    // `labelIsFlipped`) : ancré par la droite pour
                    // continuer à rayonner vers le bord malgré le +180
                    // de retournement appliqué à toute la rotation.
                    ...(flipped
                      ? { right: `calc(50% + ${startPercent}%)` }
                      : { left: `calc(50% + ${startPercent}%)` }),
                    width: `${widthPercent}%`,
                    fontSize: fontSizePx,
                  }}
                  title={seg.label}
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

      {/* Bug remonté en test réel — les libellés tronqués sur la roue
          n'offraient aucun moyen de lire un titre long en entier. Légende
          accessible (texte réel, jamais seulement une info-bulle `title`
          au survol — inutilisable au tactile) reprenant chaque secteur
          dans l'ORDRE de la roue, avec sa pastille de couleur assortie. */}
      {segments.length > 0 && (
        <ul className="flex w-full flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted">
          {segments.map((seg, i) => (
            <li key={seg.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: WHEEL_COLORS[i % WHEEL_COLORS.length] }}
              />
              {seg.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
