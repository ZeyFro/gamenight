import { safeTeamColor } from "@/lib/team-identity";

/** Pastille de couleur et emblème d'une équipe (cahier §11.2), placés devant son nom. Rien si aucun n'est choisi. */
export function TeamBadge({ color, emblem }: { color: string | null | undefined; emblem: string | null | undefined }) {
  const safe = safeTeamColor(color);
  if (!safe && !emblem) return null;
  return <span className="mr-2 inline-flex items-center gap-1 align-middle">
    {safe && <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border border-border" style={{ backgroundColor: safe }} />}
    {emblem && <span aria-hidden="true">{emblem}</span>}
  </span>;
}
