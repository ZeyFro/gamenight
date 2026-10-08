"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Logo } from "@/components/Logo";
import { Avatar } from "@/components/ui/Avatar";
import { CalendarIcon, DiceIcon, LibraryIcon, TrophyIcon, UserIcon, UsersIcon } from "@/components/icons";
import { MotionToggle } from "@/components/app/MotionBackground";

export const SIDEBAR_GROUPS = [
  { label: "Jouer ensemble", links: [
    { href: "/", label: "Accueil", icon: DiceIcon },
    { href: "/sessions", label: "Soirées", icon: CalendarIcon },
    { href: "/roulette", label: "Roulette", icon: DiceIcon },
    { href: "/tournois", label: "Tournois", icon: TrophyIcon },
    { href: "/calendrier", label: "Calendrier", icon: CalendarIcon },
  ] },
  { label: "Les jeux", links: [
    { href: "/bibliotheque", label: "Ma bibliothèque", icon: LibraryIcon },
    { href: "/bibliotheque/groupe", label: "Bibliothèque du groupe", icon: UsersIcon },
    { href: "/tierlist", label: "Tierlist", icon: TrophyIcon },
    { href: "/wishlist", label: "À acheter", icon: LibraryIcon },
    { href: "/bibliotheque/a-verifier", label: "À vérifier", icon: LibraryIcon },
  ] },
  { label: "La communauté", links: [
    { href: "/potes", label: "Potes", icon: UsersIcon },
    { href: "/classement", label: "Classement", icon: TrophyIcon },
    { href: "/profil", label: "Mon profil", icon: UserIcon },
  ] },
] as const;

// Le lien le plus précis gagne : « Ma bibliothèque » ne reste pas actif
// sur la bibliothèque du groupe. Pas de préchargement massif de toutes
// les routes collectives simplement parce que le menu est visible.
export function activeSidebarHref(pathname: string): string | undefined {
  return SIDEBAR_GROUPS.flatMap((group) => [...group.links])
    .filter(({ href }) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

interface SidebarUser { name: string; avatar: string | null; level: number; xp: number }

export function Sidebar({ user }: { user: SidebarUser }) {
  const active = activeSidebarHref(usePathname());
  function content(mobile: boolean) {
    const link = (href: string, children: React.ReactNode, className: string, current = false) => {
      const element = <Link href={href} prefetch={false} className={className} aria-current={current ? "page" : undefined}>{children}</Link>;
      return mobile ? <Dialog.Close asChild>{element}</Dialog.Close> : element;
    };
    return <>
      {link("/", <Logo className="text-xl" />, "gn-sidebar-brand")}
      <div className="gn-sidebar-scroll">
        <nav aria-label={mobile ? "Navigation mobile" : "Navigation principale"}>
          {SIDEBAR_GROUPS.map((group) => <div className="gn-nav-group" key={group.label}>
            <p className="gn-eyebrow">{group.label}</p>
            {group.links.map(({ href, label, icon: Icon }) => <div key={href}>
              {link(href, <><Icon className="h-5 w-5 shrink-0" /><span>{label}</span></>, "gn-nav-link", active === href)}
            </div>)}
          </div>)}
        </nav>
        <div className="gn-sidebar-help">
          {link("/guide", <>↗ Le guide GameNight</>, "gn-nav-link")}
          <MotionToggle />
        </div>
      </div>
      {link("/profil", <><Avatar src={user.avatar} alt="" size={38} /><span className="min-w-0"><b className="block truncate">{user.name}</b><small className="text-muted">Niveau {user.level} · {user.xp.toLocaleString("fr-FR")} XP</small></span></>, "gn-sidebar-profile")}
    </>;
  }
  return <>
    <aside className="gn-sidebar hidden lg:flex">{content(false)}</aside>
    <Dialog.Root>
      <Dialog.Trigger asChild><button type="button" className="gn-menu-button lg:hidden" aria-label="Ouvrir le menu">☰</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
        <Dialog.Content className="gn-sidebar gn-mobile-sidebar">
          <Dialog.Title className="sr-only">Navigation GameNight</Dialog.Title>
          <Dialog.Description className="sr-only">Choisis une page de ton serveur.</Dialog.Description>
          <Dialog.Close className="gn-drawer-close" aria-label="Fermer le menu">×</Dialog.Close>
          {content(true)}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
