/**
 * Couleur perso (PR 4/4, sous-PR 1) — palette curatée proposée dans le
 * color picker de `/profil/parametres`, et utilisée par le backfill
 * (`prisma/backfill-user-colors.mjs`, qui duplique cette liste — pas
 * d'accès aux alias `@/...` depuis un script Node/ESM autonome, même
 * convention que les autres backfills de ce projet) pour diversifier les
 * comptes qui n'ont jamais choisi de couleur. Le violet en premier =
 * l'accent existant de l'app, cohérent comme choix par défaut avant tout
 * choix explicite.
 */
export const USER_COLOR_PALETTE = [
  { hex: "#8b5cf6", label: "Violet" }, // accent existant, défaut de l'app
  { hex: "#ef4444", label: "Rouge" },
  { hex: "#f97316", label: "Orange" },
  { hex: "#eab308", label: "Jaune" },
  { hex: "#22c55e", label: "Vert" },
  { hex: "#06b6d4", label: "Cyan" },
  { hex: "#3b82f6", label: "Bleu" },
  { hex: "#ec4899", label: "Rose" },
  { hex: "#f8fafc", label: "Blanc" },
  { hex: "#64748b", label: "Anthracite" },
] as const;

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `null` si `hex` n'est pas un `#RRGGBB` valide. */
export function hexToRgb(hex: string): Rgb | null {
  if (!isValidHexColor(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Dégradé de bannière fallback (`/profil`, quand `bannerUrl` est vide),
 * recoloré à la couleur perso — même formule à deux radial-gradient que
 * `.profile-banner-default` (globals.css), qui utilisait en dur
 * `var(--accent)`/`var(--accent-active)`. Ici on varie juste l'opacité du
 * mix (55%/45%) plutôt que d'inventer une variante "active" pour une
 * couleur arbitraire choisie par l'utilisateur.
 */
export function bannerFallbackStyle(color: string): { background: string } {
  return {
    background: `radial-gradient(120% 140% at 15% 0%, color-mix(in srgb, ${color} 55%, transparent), transparent 60%), radial-gradient(100% 130% at 100% 100%, color-mix(in srgb, ${color} 45%, transparent), transparent 65%), var(--surface)`,
  };
}
