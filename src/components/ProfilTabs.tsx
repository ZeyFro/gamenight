"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/profil", label: "Aperçu" },
  { href: "/profil/historique", label: "Historique soirées" },
  { href: "/profil/superlatifs", label: "Superlatifs gagnés" },
  { href: "/profil/badges", label: "Badges" },
  // Pas de sous-route dédiée : /tierlist existe déjà (PR 6/9, onglet de
  // LibraryTabs) et fonctionne très bien — dupliquer la tierlist sous
  // /profil/tierlist aurait fait deux implémentations à maintenir en
  // parallèle pour la même fonctionnalité. Cet onglet navigue simplement
  // vers la page existante.
  { href: "/tierlist", label: "Tierlist" },
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
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 px-1 pb-3 text-sm font-medium transition-colors ${
              active
                ? "border-b-2 border-accent text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
