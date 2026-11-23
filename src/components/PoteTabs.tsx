"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { TabLink } from "@/components/ui/TabLink";

const TAB_LABELS = [
  { suffix: "", label: "Dispos" },
  { suffix: "/bibliotheque", label: "Bibliothèque" },
  { suffix: "/tierlist", label: "Jeux classés" },
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
  // Ouvert directement sur un onglet à droite (Badges, Récompenses), la barre défile jusqu’à lui sur téléphone.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => { bar.current?.querySelector("[aria-current=page]")?.scrollIntoView?.({ inline: "center", block: "nearest" }); }, [pathname]);

  return (
    <div ref={bar} className="flex gap-4 overflow-x-auto border-b border-border">
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
