import type { ComponentProps } from "react";

/**
 * Card partagée — glassmorphism subtil (design de fond) : fond semi-
 * transparent (`bg-surface/70`) + bordure claire type "verre"
 * (`border-white/10`) + flou seulement à partir de `sm:` (`backdrop-blur-
 * sm`, coûteux au scroll sur mobile — désactivé en dessous, se contente
 * du fond semi-transparent uni). Sans support `backdrop-filter`, le
 * navigateur ignore simplement la classe et garde ce fond semi-
 * transparent — pas de `@supports` nécessaire pour un fallback correct.
 * Le contenu (texte `--foreground`/`--muted`) reste 100% lisible, le
 * verre n'affecte que le fond derrière la card.
 */
export function Card({
  className = "",
  glow = false,
  children,
  ...rest
}: ComponentProps<"div"> & { glow?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-surface/70 p-6 sm:p-8 sm:backdrop-blur-sm ${
        glow ? "transition-all duration-200 hover:card-glow" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
