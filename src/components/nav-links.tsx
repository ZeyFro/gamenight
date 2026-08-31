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
 *
 * Refonte /calendrier : l'entrée "Dispos" (`/disponibilites`) devient
 * "Calendrier" (`/calendrier`), qui superpose déjà dispos, sessions et
 * votes — `/disponibilites` reste pleinement fonctionnelle et accessible
 * via les liens croisés posés à l'intérieur de `/calendrier`, mais n'a
 * plus besoin de sa propre entrée de nav principale. Même `CalendarIcon`
 * (déjà thématiquement juste), pas de 7e icône.
 */
export const NAV_LINKS = [
  { href: "/bibliotheque", label: "Bibliothèque", icon: LibraryIcon },
  { href: "/potes", label: "Potes", icon: UsersIcon },
  { href: "/calendrier", label: "Calendrier", icon: CalendarIcon },
  { href: "/sessions", label: "Soirées", icon: DiceIcon },
  { href: "/classement", label: "Classement", icon: TrophyIcon },
  { href: "/profil", label: "Profil", icon: UserIcon },
] as const;
