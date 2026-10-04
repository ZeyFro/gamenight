/**
 * GameNight — jetons de design « centre de commande ».
 *
 * TypeScript PUR : aucun import, aucun React, aucune API navigateur. Ce
 * fichier est repris tel quel dans l'app Expo (React Native) : toutes les
 * valeurs sont donc des nombres (px / ms) ou des chaînes de couleur, jamais
 * du CSS (`16px`, `linear-gradient(…)`, `box-shadow`…). La traduction vers
 * le web vit à part, dans `css-variables.ts` (→ `tokens.css`).
 *
 * Unités : espacements, rayons, tailles de police, interlignes de calque,
 * ombres et blur en px ; durées en ms ; `lineHeight` en ratio (sans unité) ;
 * angles de dégradé en degrés (0 = vers le haut, sens horaire, comme CSS).
 *
 * Direction validée : fond sombre, violet + magenta + or, verre dépoli,
 * grille bento, barre de navigation basse avec bouton central « Jouer
 * maintenant ».
 */

export const colors = {
  background: {
    base: "#07060f",
    raised: "#0d0b1a",
    overlay: "#14112a",
  },
  /** Verre dépoli : à poser sur `background`, jamais seul sur du blanc. */
  glass: {
    fill: "rgba(255,255,255,0.05)",
    fillStrong: "rgba(255,255,255,0.09)",
    border: "rgba(255,255,255,0.10)",
    borderStrong: "rgba(255,255,255,0.20)",
  },
  text: {
    primary: "#f6f4ff",
    secondary: "#cfcbe8",
    muted: "#a8a3c7",
    /** Décoratif / placeholder seulement (contraste ≈ 3,6:1, pas pour du texte courant). */
    faint: "#7a7599",
    onAccent: "#ffffff",
  },
  violet: {
    300: "#c4b5fd",
    400: "#a78bfa",
    500: "#8b5cf6",
    600: "#7c3aed",
    700: "#6d28d9",
  },
  magenta: {
    300: "#f0abfc",
    400: "#e879f9",
    500: "#d946ef",
    600: "#c026d3",
  },
  gold: {
    300: "#fde68a",
    400: "#f5c451",
    500: "#e0a526",
    600: "#b7791f",
  },
  status: {
    success: "#34d399",
    danger: "#fb7185",
    warning: "#f5c451",
    info: "#60a5fa",
  },
} as const;

export interface GradientStop {
  readonly color: string;
  /** Position de 0 à 1. */
  readonly at: number;
}

export interface Gradient {
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

export const gradients = {
  /** Bouton d'action principal (texte blanc : contraste ≥ 4,5:1 sur les deux bouts). */
  action: {
    angle: 135,
    stops: [
      { color: colors.violet[600], at: 0 },
      { color: colors.magenta[600], at: 1 },
    ],
  },
  /** Mise en avant de marque (barres de progression, accents). */
  brand: {
    angle: 135,
    stops: [
      { color: colors.violet[500], at: 0 },
      { color: colors.magenta[500], at: 1 },
    ],
  },
  gold: {
    angle: 135,
    stops: [
      { color: colors.gold[300], at: 0 },
      { color: colors.gold[400], at: 0.5 },
      { color: colors.gold[500], at: 1 },
    ],
  },
} as const satisfies Record<string, Gradient>;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  "2xl": 28,
  pill: 999,
} as const;

export interface ShadowLayer {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
}

export interface Shadow {
  readonly layers: readonly ShadowLayer[];
  /** Android (React Native) : `elevation`. Ignoré sur le web. */
  readonly elevation: number;
}

export const shadows = {
  card: {
    layers: [{ x: 0, y: 10, blur: 30, spread: -12, color: "rgba(0,0,0,0.6)" }],
    elevation: 4,
  },
  glowViolet: {
    layers: [{ x: 0, y: 0, blur: 28, spread: -6, color: "rgba(139,92,246,0.55)" }],
    elevation: 6,
  },
  glowMagenta: {
    layers: [{ x: 0, y: 0, blur: 28, spread: -6, color: "rgba(217,70,239,0.5)" }],
    elevation: 6,
  },
  glowGold: {
    layers: [{ x: 0, y: 0, blur: 26, spread: -6, color: "rgba(245,196,81,0.5)" }],
    elevation: 6,
  },
  fab: {
    layers: [
      { x: 0, y: 8, blur: 24, spread: -4, color: "rgba(124,58,237,0.7)" },
      { x: 0, y: 0, blur: 0, spread: 4, color: "rgba(7,6,15,0.9)" },
    ],
    elevation: 12,
  },
} as const satisfies Record<string, Shadow>;

export const typography = {
  /** Polices à charger (Geist côté web via next/font, expo-font côté Expo). */
  fontFamily: { sans: "Geist", mono: "Geist Mono" },
  fontSize: { xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, "2xl": 30, "3xl": 38 },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
  lineHeight: { tight: 1.15, snug: 1.3, normal: 1.5 },
  /** px (React Native n'accepte pas l'em). */
  letterSpacing: { tight: -0.4, normal: 0, wide: 0.6, caps: 1.2 },
} as const;

export const motion = {
  duration: { fast: 120, base: 200, slow: 350, enter: 420 },
  /** Courbes de Bézier cubiques `[x1, y1, x2, y2]`. */
  easing: {
    standard: [0.2, 0, 0, 1],
    emphasized: [0.3, 0, 0, 1],
    exit: [0.4, 0, 1, 1],
  },
  /** Ressorts (Framer Motion `type: "spring"`, Reanimated `withSpring`). */
  spring: {
    snappy: { stiffness: 420, damping: 30, mass: 1 },
    bouncy: { stiffness: 320, damping: 18, mass: 1 },
  },
} as const;

export const layout = {
  tapTarget: 44,
  navHeight: 64,
  fabSize: 64,
  /** De combien le bouton central dépasse au-dessus de la barre. */
  fabLift: 22,
  gutter: 16,
  contentMaxWidth: 1120,
  /** Flou du verre dépoli. */
  glassBlur: 24,
} as const;

export const zIndex = {
  content: 1,
  nav: 20,
  fab: 30,
  sheet: 40,
  /** Écran de prévisualisation plein cadre, au-dessus de l'habillage existant. */
  screen: 60,
} as const;

export const tokens = {
  colors,
  gradients,
  spacing,
  radii,
  shadows,
  typography,
  motion,
  layout,
  zIndex,
} as const;

export type Tokens = typeof tokens;
