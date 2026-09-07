"use client";

import { usePathname } from "next/navigation";
import { TabLink } from "@/components/ui/TabLink";

const TABS = [
  { href: "/profil", label: "Aperçu" },
  { href: "/profil/historique", label: "Historique soirées" },
  { href: "/profil/superlatifs", label: "Récompenses gagnées" },
  { href: "/profil/badges", label: "Badges" },
  // Fix UX (après test prod PR 8/9) : pointait vers /tierlist (page
  // top-level), ce qui faisait sortir du profil au clic. Sous-route
  // dédiée maintenant, qui réutilise TierlistBoard tel quel (pas de
  // logique dupliquée) — /tierlist reste utilisable en parallèle depuis
  // LibraryTabs.
  { href: "/profil/tierlist", label: "Tierlist" },
  // Sprint 4 (Saisons mensuelles) — résultats passés, saison par saison.
  { href: "/profil/saisons", label: "Saisons" },
  { href: "/profil/parametres", label: "Rappels perso" },
] as const;

/**
 * Onglets du profil rich (PR 8/9) — même pattern que `PoteTabs` (actif
 * déterminé par `usePathname()`, pas une prop explicite : un seul
 * composant sert toutes les sous-routes de `/profil` sans que chacune
 * ait à se souvenir de son propre nom d'onglet).
 */
export function ProfilTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-4 overflow-x-auto border-b border-border">
      {TABS.map((tab) => (
        <TabLink key={tab.href} href={tab.href} active={pathname === tab.href} layoutId="profil-tabs-underline">
          {tab.label}
        </TabLink>
      ))}
    </div>
  );
}
