import Link from "next/link";

const TABS = [
  { href: "/bibliotheque", label: "Ma bibliothèque", key: "perso" },
  { href: "/bibliotheque/groupe", label: "Groupe", key: "groupe" },
] as const;

export function LibraryTabs({ active }: { active: "perso" | "groupe" }) {
  return (
    <div className="flex gap-4 border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`px-1 pb-3 text-sm font-medium transition-colors ${
            active === tab.key
              ? "border-b-2 border-accent text-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
