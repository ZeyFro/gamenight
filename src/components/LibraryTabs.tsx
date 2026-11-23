import { TabLink } from "@/components/ui/TabLink";
import { plural } from "@/lib/plural";

/** Sens du badge de l'onglet « À vérifier » (infobulle et lecteur d'écran) : un nouveau ne sait pas ce qu'il doit vérifier. */
export const TO_VERIFY_HELP = "Jeux dont le mode de jeu (solo, coop, en ligne) n'est pas encore confirmé : ouvre l'onglet pour les valider en quelques clics.";

const TABS = [
  { href: "/bibliotheque", label: "Ma bibliothèque", key: "perso" },
  { href: "/bibliotheque/groupe", label: "Groupe", key: "groupe" },
  { href: "/bibliotheque/suggestions", label: "Suggestions", key: "suggestions" },
  { href: "/tierlist", label: "Classement des jeux", key: "tierlist" },
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
  active: "perso" | "groupe" | "tierlist" | "a-verifier" | "wishlist" | "suggestions";
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
    // Mobile (phase 2) : six vues ne tiennent pas à 320 px. La barre défile
    // déjà, on y ajoute un nom accessible, un défilement par onglet et un
    // espacement plus serré pour que la coupure signale la suite.
    <nav aria-label="Vues de la bibliothèque" className="gn-scroll-x flex gap-3 border-b border-border sm:gap-4">
      {TABS.map((tab) => (
        <TabLink key={tab.key} href={tab.href} active={active === tab.key} layoutId="library-tabs-underline" className="snap-start">
          {tab.label}
          {tab.key === "a-verifier" && !!toVerifyCount && toVerifyCount > 0 && (
            <span
              title={TO_VERIFY_HELP}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground"
            >
              <span aria-hidden="true">{toVerifyCount}</span>
              <span className="sr-only">{`${toVerifyCount} ${plural(toVerifyCount, "jeu", "jeux")} à vérifier. ${TO_VERIFY_HELP}`}</span>
            </span>
          )}
        </TabLink>
      ))}
    </nav>
  );
}
