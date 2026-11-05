import Link from "next/link";
import { Card } from "@/components/ui/Card";

const ENTRY_POINTS = [
  {
    href: "/equipes",
    icon: "⚔️",
    title: "Équipes",
    description: "Trouve des joueurs ou recrute pour ton équipe.",
  },
  {
    href: "/sessions",
    icon: "🎲",
    title: "Soirées",
    description: "Propose une soirée ou rejoins le prochain rendez-vous.",
  },
  {
    href: "/tower",
    icon: "🗼",
    title: "The Tower",
    description: "Retrouve les défis, ton ascension et le classement.",
  },
] as const;

export function TowerEntryPoints() {
  return (
    <nav
      aria-label="Espaces de la communauté"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {ENTRY_POINTS.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className="group rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Card className="flex h-full items-start gap-3 transition-colors group-hover:bg-surface-hover">
            <span aria-hidden="true" className="text-xl">
              {entry.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-foreground">{entry.title}</span>
              <span className="mt-1 block text-sm text-muted">{entry.description}</span>
            </span>
          </Card>
        </Link>
      ))}
    </nav>
  );
}
