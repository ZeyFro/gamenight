/**
 * Tags libres (Sprint 3, FEATURE 6) — chaque pote s'attribue depuis son
 * profil (`/profil/parametres`), réutilisés à la création d'une soirée
 * pour cocher d'un coup tous les potes portant un tag donné. `Tag` n'a
 * volontairement pas de colonne couleur en base (pas demandé, un tag de
 * plus ne justifie pas un color picker dédié) — la couleur affichée est
 * dérivée du nom, déterministe (même tag = même couleur partout, sans
 * état à synchroniser), piochée dans la même palette que `User.color`
 * (cf. `src/lib/user-color.ts`) moins le blanc (peu lisible en chip).
 */
const TAG_COLOR_PALETTE = [
  "#8b5cf6",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#ec4899",
] as const;

export function tagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % TAG_COLOR_PALETTE.length;
  return TAG_COLOR_PALETTE[index];
}
