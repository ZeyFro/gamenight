import { CalendarIcon, DiceIcon, LibraryIcon, UserIcon } from "@/components/icons";

export const NAV_LINKS = [
  { href: "/bibliotheque", label: "Bibliothèque", icon: LibraryIcon },
  { href: "/disponibilites", label: "Dispos", icon: CalendarIcon },
  { href: "/sessions", label: "Soirées", icon: DiceIcon },
  { href: "/profil", label: "Profil", icon: UserIcon },
] as const;
