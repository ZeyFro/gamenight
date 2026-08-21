import Image from "next/image";

/**
 * Avatar circulaire réutilisable (potes, possesseurs d'un jeu…). Sans
 * `discordAvatar` (compte tout neuf, avant que Discord ait propagé
 * l'avatar), on retombe sur un rond avec l'initiale plutôt que de casser
 * le layout ou d'afficher une image cassée.
 */
export function Avatar({
  src,
  alt,
  size = 40,
  className = "",
}: {
  src: string | null;
  alt: string;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        title={alt}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      title={alt}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-muted ${className}`}
    >
      {alt.slice(0, 1).toUpperCase()}
    </div>
  );
}
