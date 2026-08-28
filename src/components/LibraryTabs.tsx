import Link from "next/link";

const TABS = [
  { href: "/bibliotheque", label: "Ma bibliothèque", key: "perso" },
  { href: "/bibliotheque/groupe", label: "Groupe", key: "groupe" },
  { href: "/tierlist", label: "Tierlist", key: "tierlist" },
  { href: "/bibliotheque/a-verifier", label: "À vérifier", key: "a-verifier" },
] as const;

export function LibraryTabs({
  active,
  toVerifyCount,
}: {
  active: "perso" | "groupe" | "tierlist" | "a-verifier";
  /**
   * Compteur affiché sur l'onglet "À vérifier" (PR 32.6, Bloc B) — optionnel :
   * seules `/bibliotheque` et `/bibliotheque/a-verifier` chargent déjà les
   * jeux nécessaires pour le calculer sans requête dédiée, `/bibliotheque/
   * groupe` et `/tierlist` s'en passent plutôt que de payer une requête
   * supplémentaire juste pour ce badge.
   */
  toVerifyCount?: number;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`flex shrink-0 items-center gap-1.5 px-1 pb-3 text-sm font-medium transition-colors ${
            active === tab.key
              ? "border-b-2 border-accent text-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {tab.label}
          {tab.key === "a-verifier" && !!toVerifyCount && toVerifyCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
              {toVerifyCount}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
