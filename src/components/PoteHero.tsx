"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Aperçu d'un pote (bannière, avatar, badges, matériel, identifiants) : affiché seulement sur `/potes/[id]`. Sur ses
 * sous-pages (bibliothèque, tierlist, badges, récompenses), il repoussait le vrai contenu sous le pli d'un téléphone :
 * une adresse ouverte directement montrait « l'aperçu du profil au lieu de son contenu » (même défaut que `/profil`,
 * corrigé par ProfilHero). Les sous-pages affichent à la place `compact`, puis leurs onglets et leur contenu.
 * `usePathname` est disponible au rendu serveur : la première réponse HTML est déjà la bonne.
 */
export function PoteHero({ poteId, children, compact }: { poteId: string; children: ReactNode; compact: ReactNode }) {
  const pathname = usePathname();
  return <>{pathname === `/potes/${poteId}` ? children : compact}</>;
}
