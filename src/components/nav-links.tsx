import {
  CalendarIcon,
  DiceIcon,
  LibraryIcon,
  TrophyIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";

/**
 * PR 9/9 : ajout de `/classement` en 6e item — dernière étape du chantier
 * XP/niveaux/rangs, assez centrale (consulté régulièrement, comme un
 * classement de jeu) pour mériter une place dans la nav principale plutôt
 * qu'un lien secondaire enfoui dans `/profil` (contrairement à
 * `/tierlist`, réservé à `LibraryTabs` : usage plus ponctuel). `BottomNav`
 * passe de `grid-cols-5` à `grid-cols-6` en conséquence.
 */
export const NAV_LINKS = [
  { href: "/bibliotheque", label: "Bibliothèque", icon: LibraryIcon },
  { href: "/potes", label: "Potes", icon: UsersIcon },
  { href: "/disponibilites", label: "Dispos", icon: CalendarIcon },
  { href: "/sessions", label: "Soirées", icon: DiceIcon },
  { href: "/classement", label: "Classement", icon: TrophyIcon },
  { href: "/profil", label: "Profil", icon: UserIcon },
] as const;
