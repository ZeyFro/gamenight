import type { ComponentProps } from "react";

/**
 * Carte commune de la refonte : fond sombre opaque, bordure et ombre
 * franche. Les pages gardent leurs contenus/actions ; aucun flou continu
 * au défilement, notamment sur mobile.
 */
export function Card({
  className = "",
  glow = false,
  children,
  ...rest
}: ComponentProps<"div"> & { glow?: boolean }) {
  return (
    <div
      className={`gn-card rounded-xl border-2 border-border bg-surface p-6 sm:p-8 ${
        glow ? "transition-all duration-200 hover:card-glow" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
