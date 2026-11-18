import {
  CalendarIcon,
  HomeIcon,
  LibraryIcon,
  MoonIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";

/**
 * Navigation principale (barre basse mobile) — une seule source pour les
 * libellés, destinations et icônes, afin que la barre basse et le tiroir
 * `Sidebar` ne divergent plus.
 *
 * P1-03 (navigation) :
 * - `Accueil` entre dans la barre basse : sur mobile, le seul retour à
 *   l'accueil était le logo du header, masqué par `.gn-topbar-with-picker`
 *   quand le sélecteur de serveur est actif.
 * - `Classement` sort de la barre basse (il reste dans le tiroir, sur
 *   l'accueil et dans `/profil`) : six cibles tactiles de 56 px minimum
 *   tiennent à 320 px de large, sept non, et `Classement` débordait déjà de
 *   sa case à 360 px.
 * - `shortLabel` n'existe que pour la barre basse : le libellé complet reste
 *   la référence, le libellé court évite un débordement à 360 px. Le nom
 *   accessible du lien contient toujours le texte visible.
 */
export const NAV_LINKS = [
  { href: "/", label: "Accueil", shortLabel: "Accueil", icon: HomeIcon },
  { href: "/sessions", label: "Soirées", shortLabel: "Soirées", icon: MoonIcon },
  { href: "/bibliotheque", label: "Bibliothèque", shortLabel: "Jeux", icon: LibraryIcon },
  { href: "/calendrier", label: "Calendrier", shortLabel: "Calendrier", icon: CalendarIcon },
  { href: "/potes", label: "Potes", shortLabel: "Potes", icon: UsersIcon },
  { href: "/profil", label: "Profil", shortLabel: "Profil", icon: UserIcon },
] as const;
