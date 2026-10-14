"use client";

import { usePathname } from "next/navigation";
import { TabLink } from "@/components/ui/TabLink";

const TAB_LABELS = [
  { suffix: "", label: "Dispos" },
  { suffix: "/bibliotheque", label: "Bibliothèque" },
  { suffix: "/tierlist", label: "Tierlist" },
  { suffix: "/badges", label: "Badges" },
  { suffix: "/superlatifs", label: "Récompenses" },
] as const;

/**
 * Onglets de `/potes/[id]` (FIX UX préliminaire, PR 7/9) — remplace
 * l'ancien empilement Dispos/Bibliothèque/Tierlist sur une seule page
 * (scroll interminable). Même style visuel que `LibraryTabs`, mais actif
 * déterminé par `usePathname()` (comme `BottomNav`) plutôt qu'une prop
 * `active` explicite : un seul composant sert les 4 sous-routes sans que
 * chacune ait à se souvenir de son propre nom d'onglet.
 */
export function PoteTabs({ poteId }: { poteId: string }) {
  const pathname = usePathname();
  const base = `/potes/${poteId}`;

  return (
    <div className="flex gap-4 overflow-x-auto border-b border-border">
      {TAB_LABELS.map(({ suffix, label }) => {
        const href = `${base}${suffix}`;
        return (
          <TabLink key={href} href={href} active={pathname === href} layoutId="pote-tabs-underline">
            {label}
          </TabLink>
        );
      })}
    </div>
  );
}
