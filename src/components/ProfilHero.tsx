"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Aperçu du profil (bannière, avatar, carte d'XP, statistiques) : affiché seulement sur `/profil`. Sur les sous-pages
 * (`/profil/badges`, `/profil/historique`…), il occupait les deux premiers écrans d'un téléphone et repoussait le vrai
 * contenu sous le pli : une adresse ouverte directement montrait « l'aperçu du profil au lieu de son contenu ».
 * Les sous-pages affichent à la place `compact` (retour à l'aperçu et nom), puis leurs onglets et leur contenu.
 * `usePathname` est disponible au rendu serveur : la première réponse HTML est déjà la bonne.
 */
export function ProfilHero({ children, compact }: { children: ReactNode; compact: ReactNode }) {
  const pathname = usePathname();
  return <>{pathname === "/profil" ? children : compact}</>;
}
