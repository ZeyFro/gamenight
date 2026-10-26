import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { rankForLevel, titleForLevel } from "@/lib/xp";
import { getTowerProgress } from "@/lib/tower-progression";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";

export const metadata = pageMetadata("Ascension");

const LINKS = [
  { href: "/profil/badges", label: "Badges", description: "Tes distinctions gagnées et à débloquer." },
  { href: "/", label: "Défi hebdomadaire", description: "Retrouve l’objectif collectif de cette semaine sur l’accueil." },
  { href: "/saisons", label: "Saisons", description: "Consulte le classement et les podiums saisonniers." },
  { href: "/classement", label: "Classement", description: "Compare ta progression avec la communauté." },
];

export default async function AscensionPage() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");

  const communityId = await resolveActiveCommunityId(user.id);
  const community = communityId
    ? await prisma.community.findUnique({ where: { id: communityId }, select: { towerLevelsPerFloor: true } })
    : null;
  const progress = getTowerProgress(user.xpTotal, community?.towerLevelsPerFloor ?? 10);
  const rank = rankForLevel(progress.level);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <p className="text-sm font-medium text-accent">The Tower · Ta progression</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground sm:text-3xl">Étage {progress.floor}</h1>
        <p className="mt-2 text-sm text-muted">Niveau {progress.level} · {titleForLevel(progress.level)} · Rang {rank.name}</p>
      </header>

      <Card className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold text-foreground">Prochain étage</h2>
            <p className="text-sm text-muted">{progress.xpToNextFloor.toLocaleString("fr-FR")} XP restantes</p>
          </div>
          <p className="text-sm tabular-nums text-muted">{Math.floor(progress.progress * 100)} %</p>
        </div>
        <div
          role="progressbar"
          aria-label={`Progression vers l’étage ${progress.floor + 1}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(progress.progress * 100)}
          className="h-3 overflow-hidden rounded-full bg-surface-hover"
        >
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress.progress * 100}%` }} />
        </div>
        <p className="text-xs text-muted">Chaque étage couvre {community?.towerLevelsPerFloor ?? 10} niveaux. Ton XP existante reste inchangée.</p>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="tower-links-title">
        <h2 id="tower-links-title" className="font-semibold text-foreground">Poursuivre l’ascension</h2>
        {LINKS.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <Card className="flex items-center justify-between gap-3 transition-colors hover:bg-surface-hover">
              <div>
                <p className="font-medium text-foreground">{item.label}</p>
                <p className="text-sm text-muted">{item.description}</p>
              </div>
              <span aria-hidden className="text-accent">→</span>
            </Card>
          </Link>
        ))}
      </section>
    </main>
  );
}
