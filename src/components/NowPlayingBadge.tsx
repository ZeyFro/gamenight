/**
 * Pastille « En jeu » d'une carte pote (/potes, drapeau
 * `STEAM_NOW_PLAYING_ENABLED`) — violet de l'app (`accent`, #8b5cf6), point
 * qui pulse doucement (coupé si l'utilisateur réduit les animations :
 * `motion-safe`). Purement visuelle : l'information est dans le texte, le
 * point est décoratif.
 */
export function NowPlayingBadge({ game }: { game: string }) {
  return (
    <p className="flex w-fit max-w-full items-center gap-2 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-xs font-medium text-accent-hover">
      <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      <span className="truncate">En jeu · {game}</span>
    </p>
  );
}
