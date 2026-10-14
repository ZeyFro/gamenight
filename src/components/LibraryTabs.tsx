import { TabLink } from "@/components/ui/TabLink";

const TABS = [
  { href: "/bibliotheque", label: "Ma bibliothèque", key: "perso" },
  { href: "/bibliotheque/groupe", label: "Groupe", key: "groupe" },
  { href: "/tierlist", label: "Tierlist", key: "tierlist" },
  { href: "/bibliotheque/a-verifier", label: "À vérifier", key: "a-verifier" },
  // Sprint 5 (FEATURE 3, Wishlist) — `/wishlist` en route dédiée plutôt
  // qu'imbriquée sous `/bibliotheque` (même niveau que `/tierlist`, déjà
  // hors de `/bibliotheque/*`) : cohérent avec le reste des onglets ici,
  // qui mélangent déjà routes imbriquées et top-level.
  { href: "/wishlist", label: "🛒 À acheter", key: "wishlist" },
] as const;

export function LibraryTabs({
  active,
  toVerifyCount,
}: {
  active: "perso" | "groupe" | "tierlist" | "a-verifier" | "wishlist";
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
        <TabLink key={tab.key} href={tab.href} active={active === tab.key} layoutId="library-tabs-underline">
          {tab.label}
          {tab.key === "a-verifier" && !!toVerifyCount && toVerifyCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
              {toVerifyCount}
            </span>
          )}
        </TabLink>
      ))}
    </div>
  );
}
