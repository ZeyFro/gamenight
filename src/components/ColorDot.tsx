/**
 * Petite pastille de couleur perso (PR 4/4, sous-PR 1) — accent réutilisé
 * partout où la couleur d'un user doit être visible SANS toucher à
 * `RankAvatar` (dont l'anneau encode le rang, pas la couleur perso — les
 * deux sont des informations distinctes, cf. discussion de cadrage de
 * cette PR). Couleur arbitraire par utilisateur → style inline
 * obligatoire, Tailwind ne peut pas générer de classe pour une valeur hex
 * connue seulement à l'exécution.
 */
export function ColorDot({
  color,
  size = 10,
  title,
}: {
  color: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      aria-hidden={!title}
      title={title}
      style={{ backgroundColor: color, width: size, height: size }}
      className="inline-block shrink-0 rounded-full ring-2 ring-surface"
    />
  );
}
