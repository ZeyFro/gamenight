import Link from "next/link";

/**
 * "?" flottant (Sprint 2 PR-B, U2) — accès permanent à `/guide` depuis
 * n'importe quelle page, monté dans le layout racine plutôt que
 * dupliqué par page. 5 rem + zone de sécurité (encoche) sur mobile pour
 * rester au-dessus de `BottomNav` (fixe, ~56-72px), `lg:bottom-6` sur
 * desktop où `BottomNav` ne s'affiche pas.
 */
export function GuideFab() {
  return (
    <Link
      href="/guide"
      aria-label="Comment ça marche"
      title="Comment ça marche"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-lg font-semibold text-foreground shadow-lg transition-colors hover:bg-surface-hover hover:border-border-hover lg:bottom-6"
    >
      ?
    </Link>
  );
}
