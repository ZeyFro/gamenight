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
  ringColor,
}: {
  src: string | null;
  alt: string;
  size?: number;
  className?: string;
  /**
   * Anneau de couleur perso dynamique (PR 4/4, sous-PR 1 — ex.
   * `VoterAvatars`) : style inline plutôt qu'une classe Tailwind, une
   * couleur hex connue seulement à l'exécution ne peut pas être générée
   * par le JIT. À utiliser à la place des classes `ring-*` (pas en plus,
   * `boxShadow` inline prime de toute façon sur le `box-shadow` posé par
   * les utilitaires `ring-*`).
   */
  ringColor?: string;
}) {
  const ringStyle = ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : undefined;

  if (src) {
    return (
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        title={alt}
        style={ringStyle}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, ...ringStyle }}
      title={alt}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-muted ${className}`}
    >
      {alt.slice(0, 1).toUpperCase()}
    </div>
  );
}
