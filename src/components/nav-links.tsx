import {
  CalendarIcon,
  DiceIcon,
  LibraryIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";

export const NAV_LINKS = [
  { href: "/bibliotheque", label: "Bibliothèque", icon: LibraryIcon },
  { href: "/potes", label: "Potes", icon: UsersIcon },
  { href: "/disponibilites", label: "Dispos", icon: CalendarIcon },
  { href: "/sessions", label: "Soirées", icon: DiceIcon },
  { href: "/profil", label: "Profil", icon: UserIcon },
] as const;
