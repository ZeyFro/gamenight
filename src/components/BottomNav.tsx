"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS } from "@/components/nav-links";

/**
 * Barre de navigation mobile. L'état actif est signalé par trois signaux
 * (barre d'accent en haut, couleur, `aria-current`) : la couleur seule ne
 * suffit pas à distinguer la page courante (WCAG 1.4.1).
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="gn-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-6">
        {NAV_LINKS.map(({ href, label, shortLabel, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] leading-tight font-medium transition-colors ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              {active && (
                <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent" />
              )}
              <Icon className="h-5 w-5 shrink-0" />
              <span data-nav-label className="max-w-full text-center">
                {shortLabel}
                {/* Le nom accessible annonce le libellé complet, sans jamais
                    remplacer le texte visible (WCAG 2.5.3). */}
                {shortLabel !== label && <span className="sr-only">{`, ${label}`}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
