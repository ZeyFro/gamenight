import { notFound, redirect } from "next/navigation";
import { canViewPote } from "@/lib/community-isolation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { todayDateOnly } from "@/lib/wallclock";
import { AvailabilityView } from "@/components/AvailabilityView";
import { listVisibleGameLevels } from "@/lib/game-levels";
import { GAME_LEVEL_LABELS } from "@/lib/game-levels-rules";
import type { Metadata } from "next";
import { dynamicPageMetadata } from "@/lib/dynamic-page-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // Multi-communautés (PR4) : le titre ne révèle jamais le pseudo d'un
  // membre d'une autre communauté.
  return dynamicPageMetadata("Profil d'un pote", async () => {
    const viewer = await getCurrentUser();
    if (!viewer || !(await canViewPote(viewer.id, id))) return undefined;
    return (await prisma.user.findUnique({ where: { id }, select: { discordName: true } }))?.discordName;
  });
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Onglet "Dispos" (route par défaut) — voir `layout.tsx` pour l'en-tête. */
export default async function PoteDisposPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  // Multi-communautés (PR4) : contrôle répété dans chaque page (voir tierlist).
  if (!(await canViewPote(user.id, id))) notFound();

  const today = todayDateOnly();
  const [gameLevels, weeklySlots, overrides] = await Promise.all([
    listVisibleGameLevels(user.id, id),
    prisma.weeklyAvailability.findMany({
      where: { userId: id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    prisma.availabilityOverride.findMany({
      where: {
        userId: id,
        date: { gte: today, lte: new Date(today.getTime() + FOURTEEN_DAYS_MS) },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  return <>
    <AvailabilityView weeklySlots={weeklySlots} overrides={overrides} />
    {gameLevels.length > 0 && <section aria-labelledby="game-levels-title" className="mt-6 grid gap-2">
      <h2 id="game-levels-title" className="font-semibold text-foreground">Niveaux par jeu</h2>
      <ul className="grid gap-1 text-sm">
        {gameLevels.map((entry) => <li key={entry.gameId}>{entry.gameName} · <strong>{GAME_LEVEL_LABELS[entry.level]}</strong></li>)}
      </ul>
    </section>}
  </>;
}
