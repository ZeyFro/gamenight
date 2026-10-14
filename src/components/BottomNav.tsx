"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS } from "@/components/nav-links";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Accès rapides"
      className="gn-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-6">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
